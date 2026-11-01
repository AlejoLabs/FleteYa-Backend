import crypto from "crypto";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";
import type { AssignDriverInput, CancelClientRequestInput, DeliverInput, UpdateClientRatingInput, UpdateClientRequestInput, UpdateDriverRatingInput } from "../validators/client_request.validator.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";
import { findTripOrFail } from "./client_request.shared.js";
import { countTripPhotos } from "./trip_photo.service.js";
import { formatPesos, sendPush } from "../utils/push.js";

// Ciclo del viaje después de buscar: asignar conductor, avanzar estados, entregar, cancelar y calificar

// Intentos para escribir el código de entrega; después, solo el cliente puede confirmar desde su app
const MAX_DELIVERY_ATTEMPTS = 5;

const newDeliveryCode = () => crypto.randomInt(0, 10000).toString().padStart(4, "0");

// La comisión va incluida en el valor acordado: el cliente paga el valor y el conductor recibe el valor menos la comisión
const commissionFor = async (fare: number) => {
    const values = await prisma.timeAndDistanceValues.findUnique({ where: { id: 1 }, select: { commission_rate: true } });
    const rate = values?.commission_rate ?? 0;
    return { rate, amount: Math.round(fare * rate) };
}

export const assignDriver = async (userId: number, data: AssignDriverInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "asignar-conductor", `client_requests/${data.id}`);
    }
    // Antes que la oferta: un viaje ya asignado, cancelado o vencido responde "no disponible", no "sin oferta"
    if (clientRequest.status !== "CREATED") {
        throw new AppError("Este viaje ya no está disponible para asignar", 409);
    }

    // El precio sale de la oferta pendiente guardada, no de lo que mande la app: así nadie asigna un viaje con otro valor
    const offer = await prisma.driverTripOffer.findFirst({
        where: { id_client_request: data.id, id_driver: data.id_driver_assigned, status: "PENDING" },
        orderBy: { created_at: "desc" }
    });
    if (!offer) {
        throw new AppError("Ese conductor no tiene una oferta vigente para este viaje", 400);
    }
    const commission = await commissionFor(offer.fare_offered);

    const rejectedDrivers = await prisma.$transaction(async (tx) => {
        // updateMany con status CREATED y sin vencer evita que dos aceptaciones simultáneas asignen dos conductores
        const result = await tx.clientRequests.updateMany({
            where: { id: data.id, id_client: userId, status: "CREATED", expires_at: { gt: new Date() } },
            data: {
                id_driver_assigned: data.id_driver_assigned,
                status: "ACCEPTED",
                fare_assigned: offer.fare_offered,
                commission_rate: commission.rate,
                commission: commission.amount,
                delivery_code: newDeliveryCode(),
                delivery_code_attempts: 0,
            }
        });
        if (result.count === 0) {
            throw new AppError("Este viaje ya no está disponible para asignar", 409);
        }

        await tx.driverTripOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
        const others = await tx.driverTripOffer.findMany({
            where: { id_client_request: data.id, status: "PENDING" },
            select: { id_driver: true }
        });
        await tx.driverTripOffer.updateMany({
            where: { id_client_request: data.id, status: "PENDING" },
            data: { status: "REJECTED" }
        });
        return [...new Set(others.map((o) => o.id_driver))];
    });

    // Los demás conductores que ofertaron se enteran de que eligieron a otro, y la solicitud sale de la lista de todos
    for (const idDriver of rejectedDrivers) {
        notifyUser(idDriver, `offer_status/${idDriver}`, { id_client_request: data.id, status: "REJECTED", reason: "OTHER_DRIVER" });
    }
    notifyDrivers("client_request_removed", { id_client_request: data.id });
    void sendPush(data.id_driver_assigned, {
        type: "DRIVER_ASSIGNED", id_client_request: data.id,
        title: "¡Te eligieron para un flete!", body: `El cliente aceptó tu oferta de ${formatPesos(offer.fare_offered)}. Ve a recoger la carga.`
    });

    return prisma.clientRequests.findUnique({
        where: { id: data.id },
        select: { id: true, id_client: true, id_driver_assigned: true, fare_assigned: true, status: true }
    });
}

// Estados a los que el conductor asignado puede avanzar desde cada estado. "Carga recogida" (TRAVELING) pide
// la foto al cargar; terminar va por la prueba de entrega y cancelar por su propio endpoint
const NEXT_STATUSES: Record<string, ClientRequestStatus[]> = {
    ACCEPTED: ["ON_THE_WAY", "ARRIVED"],
    ON_THE_WAY: ["ARRIVED"],
    ARRIVED: ["TRAVELING"],
};

export const updateStatus = async (userId: number, data: UpdateClientRequestInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "cambiar-estado", `client_requests/${data.id}`);
    }

    const nextStatus = data.status as ClientRequestStatus;
    if (nextStatus === "FINISHED" && clientRequest.status === "TRAVELING") {
        throw new AppError("Para terminar, toma la foto de entrega y escribe el código que te dicta quien recibe", 409);
    }
    if (!(NEXT_STATUSES[clientRequest.status] ?? []).includes(nextStatus)) {
        throw new AppError(`No se puede pasar de ${clientRequest.status} a ${nextStatus}`, 409);
    }
    if (nextStatus === "TRAVELING" && await countTripPhotos(data.id, "PICKUP") === 0) {
        throw new AppError("Toma al menos una foto de la carga al recogerla", 409);
    }

    // Con el estado actual en el where, una cancelación simultánea no queda pisada por este cambio
    const result = await prisma.clientRequests.updateMany({
        where: { id: data.id, status: clientRequest.status },
        data: { status: nextStatus }
    });
    if (result.count === 0) {
        throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
    }
    if (nextStatus === "ARRIVED") {
        void sendPush(clientRequest.id_client, { type: "DRIVER_ARRIVED", id_client_request: data.id, title: "Tu conductor llegó", body: "Ya está en el punto de recogida." });
    } else if (nextStatus === "TRAVELING") {
        void sendPush(clientRequest.id_client, { type: "CARGO_PICKED_UP", id_client_request: data.id, title: "Carga recogida", body: "Tu carga va en camino al destino." });
    }
    return prisma.clientRequests.findUnique({ where: { id: data.id } });
}

// Cierra el viaje entregado y avisa a los dos (el que no hizo la acción tiene la pantalla del viaje abierta)
const finishTrip = async (id: number, idClient: number, idDriver: number, confirmedBy: "DRIVER" | "CLIENT") => {
    const result = await prisma.clientRequests.updateMany({
        where: { id, status: "TRAVELING" },
        data: { status: "FINISHED" }
    });
    if (result.count === 0) {
        throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
    }
    const payload = { id_client_request: id, status: "FINISHED" };
    notifyUser(idClient, `new_status_trip/${id}`, payload);
    notifyUser(idDriver, `new_status_trip/${id}`, payload);
    if (confirmedBy === "DRIVER") {
        void sendPush(idClient, { type: "DELIVERED", id_client_request: id, title: "Carga entregada", body: "El conductor entregó tu carga. Califica el servicio." });
    } else {
        void sendPush(idDriver, { type: "DELIVERED", id_client_request: id, title: "Entrega confirmada", body: "El cliente confirmó que recibió la carga." });
    }
    return { id, status: "FINISHED" };
}

// El conductor entrega: necesita la foto de la carga entregada y el código que le dicta quien recibe
export const deliverWithCode = async (userId: number, id: number, data: DeliverInput) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id_client: true, id_driver_assigned: true, status: true, delivery_code: true, delivery_code_attempts: true }
    });
    if (!trip) {
        throw new AppError("La solicitud de viaje no existe", 404);
    }
    if (trip.id_driver_assigned !== userId) {
        throw deny(userId, "entregar", `client_requests/${id}`);
    }
    if (trip.status !== "TRAVELING") {
        throw new AppError("Solo se entrega una carga que ya recogiste", 409);
    }
    if (await countTripPhotos(id, "DELIVERY") === 0) {
        throw new AppError("Toma una foto de la carga entregada antes de cerrar el viaje", 409);
    }
    // Viajes asignados antes de la Fase 5 no tienen código
    if (!trip.delivery_code) {
        throw new AppError("Este viaje no tiene código: pide al cliente que confirme la entrega desde su app", 409);
    }
    if (trip.delivery_code_attempts >= MAX_DELIVERY_ATTEMPTS) {
        throw new AppError("Se agotaron los intentos: pide al cliente que confirme la entrega desde su app", 429);
    }

    // Comparación en tiempo constante, como con los códigos de contraseña
    const isValid = crypto.timingSafeEqual(Buffer.from(data.code), Buffer.from(trip.delivery_code));
    if (!isValid) {
        await prisma.clientRequests.update({ where: { id }, data: { delivery_code_attempts: { increment: 1 } } });
        const left = MAX_DELIVERY_ATTEMPTS - trip.delivery_code_attempts - 1;
        throw new AppError(left > 0
            ? `Código incorrecto. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}`
            : "Código incorrecto. Se agotaron los intentos: pide al cliente que confirme la entrega desde su app", 400);
    }
    return finishTrip(id, trip.id_client, userId, "DRIVER");
}

// El cliente confirma que recibió la carga (por ejemplo, si él mismo la recibe o el conductor agotó los intentos)
export const confirmDelivery = async (userId: number, id: number) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "confirmar-entrega", `client_requests/${id}`);
    }
    if (trip.status !== "TRAVELING") {
        throw new AppError("Solo se confirma la entrega de una carga que va en camino", 409);
    }
    return finishTrip(id, userId, trip.id_driver_assigned!, "CLIENT");
}

// Quién puede cancelar y en qué estados. Con la carga ya recogida no se cancela desde la app
const CLIENT_CANCELABLE: ClientRequestStatus[] = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"];
const DRIVER_CANCELABLE: ClientRequestStatus[] = ["ACCEPTED", "ON_THE_WAY", "ARRIVED"];

export const cancelClientRequest = async (userId: number, id: number, data: CancelClientRequestInput) => {
    const trip = await findTripOrFail(id);
    const isClient = trip.id_client === userId;
    const isDriver = trip.id_driver_assigned === userId;
    if (!isClient && !isDriver) {
        throw deny(userId, "cancelar-viaje", `client_requests/${id}`);
    }

    const allowed = isClient ? CLIENT_CANCELABLE : DRIVER_CANCELABLE;
    if (trip.status === "TRAVELING") {
        throw new AppError("La carga ya fue recogida: termina el viaje para cerrarlo", 409);
    }
    if (!allowed.includes(trip.status)) {
        throw new AppError("Este viaje ya no se puede cancelar", 409);
    }

    await prisma.$transaction(async (tx) => {
        const result = await tx.clientRequests.updateMany({
            where: { id, status: trip.status },
            data: { status: "CANCELED", canceled_by: userId, cancel_reason: data.reason }
        });
        if (result.count === 0) {
            throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
        }
        await tx.driverTripOffer.updateMany({
            where: { id_client_request: id, status: "PENDING" },
            data: { status: "EXPIRED" }
        });
    });

    const payload = { id_client_request: id, canceled_by: isClient ? "CLIENT" : "DRIVER", reason: data.reason };
    if (trip.status === "CREATED") {
        notifyDrivers("client_request_removed", { id_client_request: id });
    } else {
        const otherUser = isClient ? trip.id_driver_assigned! : trip.id_client;
        notifyUser(otherUser, `trip_canceled/${id}`, payload);
        void sendPush(otherUser, {
            type: "TRIP_CANCELED", id_client_request: id,
            title: isClient ? "El cliente canceló el flete" : "El conductor canceló el flete", body: `Motivo: ${data.reason}`
        });
    }
    return { id, status: "CANCELED", ...payload };
}

// El conductor califica al cliente y viceversa, solo cuando el viaje terminó y una sola vez
export const updateClientRating = async (userId: number, data: UpdateClientRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "calificar-cliente", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const { count } = await prisma.clientRequests.updateMany({
        where: { id: data.id, client_rating: null },
        data: { client_rating: data.client_rating }
    });
    if (count === 0) {
        throw new AppError("Ya calificaste a este cliente", 409);
    }
    return { id: data.id, client_rating: data.client_rating };
}

export const updateDriverRating = async (userId: number, data: UpdateDriverRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "calificar-conductor", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const { count } = await prisma.clientRequests.updateMany({
        where: { id: data.id, driver_rating: null },
        data: { driver_rating: data.driver_rating }
    });
    if (count === 0) {
        throw new AppError("Ya calificaste a este conductor", 409);
    }
    return { id: data.id, driver_rating: data.driver_rating };
}
