import crypto from "crypto";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";
import type { AssignDriverInput, CancelClientRequestInput, DeliverInput, UpdateClientRatingInput, UpdateClientRequestInput, UpdateDriverRatingInput } from "../validators/client_request.validator.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";
import { findTripOrFail } from "./client_request.shared.js";
import { countTripPhotos } from "./trip_photo.service.js";
import { pushAmount, sendPush } from "../utils/push.js";
import { getCountry, getCurrency, ratesFor } from "./countries.service.js";
import { roundMoney } from "../utils/money.js";

// Ciclo del viaje después de buscar: asignar conductor, avanzar estados, entregar, cancelar y calificar

// Intentos para escribir el código de entrega; después, solo el cliente puede confirmar desde su app
export const MAX_DELIVERY_ATTEMPTS = 5;

const newDeliveryCode = () => crypto.randomInt(0, 10000).toString().padStart(4, "0");

// La comisión va incluida en el valor acordado: el cliente paga el valor y el conductor recibe el valor menos la comisión.
// Sale del porcentaje del país del viaje (el suyo o el de su moneda) y se calcula en la moneda del viaje
// (con centavos en EUR o USD)
const commissionFor = async (fare: number, trip: { country_code: string; currency: string }) => {
    const { commission_rate: rate } = await ratesFor(await getCountry(trip.country_code));
    return { rate, amount: roundMoney(fare * rate, (await getCurrency(trip.currency)).decimals) };
}

export const assignDriver = async (userId: number, data: AssignDriverInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "asignar-conductor", `client_requests/${data.id}`);
    }
    // Antes que la oferta: un viaje ya asignado, cancelado o vencido responde "no disponible", no "sin oferta"
    if (clientRequest.status !== "CREATED") {
        throw new AppError("TRIP_NOT_ASSIGNABLE", 409);
    }

    // El precio sale de la oferta pendiente guardada, no de lo que mande la app: así nadie asigna un viaje con otro valor
    const offer = await prisma.driverTripOffer.findFirst({
        where: { id_client_request: data.id, id_driver: data.id_driver_assigned, status: "PENDING" },
        orderBy: { created_at: "desc" }
    });
    if (!offer) {
        throw new AppError("DRIVER_HAS_NO_OFFER", 400);
    }
    const commission = await commissionFor(offer.fare_offered, clientRequest);

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
            throw new AppError("TRIP_NOT_ASSIGNABLE", 409);
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
    void sendPush(data.id_driver_assigned, (language) => ({
        type: "DRIVER_ASSIGNED", id_client_request: data.id, key: "DRIVER_ASSIGNED", params: { amount: pushAmount(offer.fare_offered, clientRequest.currency, language) },
    }));

    return prisma.clientRequests.findUnique({
        where: { id: data.id },
        select: { id: true, id_client: true, id_driver_assigned: true, fare_assigned: true, currency: true, status: true }
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
        throw new AppError("DELIVERY_PROOF_REQUIRED", 409);
    }
    if (!(NEXT_STATUSES[clientRequest.status] ?? []).includes(nextStatus)) {
        throw new AppError("INVALID_STATUS_CHANGE", 409, undefined, { from: clientRequest.status, to: nextStatus });
    }
    if (nextStatus === "TRAVELING" && await countTripPhotos(data.id, "PICKUP") === 0) {
        throw new AppError("PICKUP_PHOTO_REQUIRED", 409);
    }

    // Con el estado actual en el where, una cancelación simultánea no queda pisada por este cambio
    const result = await prisma.clientRequests.updateMany({
        where: { id: data.id, status: clientRequest.status },
        data: { status: nextStatus }
    });
    if (result.count === 0) {
        throw new AppError("TRIP_CHANGED", 409);
    }
    if (nextStatus === "ARRIVED") {
        void sendPush(clientRequest.id_client, { type: "DRIVER_ARRIVED", id_client_request: data.id, key: "DRIVER_ARRIVED" });
    } else if (nextStatus === "TRAVELING") {
        void sendPush(clientRequest.id_client, { type: "CARGO_PICKED_UP", id_client_request: data.id, key: "CARGO_PICKED_UP" });
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
        throw new AppError("TRIP_CHANGED", 409);
    }
    const payload = { id_client_request: id, status: "FINISHED" };
    notifyUser(idClient, `new_status_trip/${id}`, payload);
    notifyUser(idDriver, `new_status_trip/${id}`, payload);
    if (confirmedBy === "DRIVER") {
        void sendPush(idClient, { type: "DELIVERED", id_client_request: id, key: "DELIVERED_CLIENT" });
    } else {
        void sendPush(idDriver, { type: "DELIVERED", id_client_request: id, key: "DELIVERED_DRIVER" });
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
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    if (trip.id_driver_assigned !== userId) {
        throw deny(userId, "entregar", `client_requests/${id}`);
    }
    if (trip.status !== "TRAVELING") {
        throw new AppError("ONLY_DELIVER_PICKED_UP", 409);
    }
    if (await countTripPhotos(id, "DELIVERY") === 0) {
        throw new AppError("DELIVERY_PHOTO_REQUIRED", 409);
    }
    // Viajes asignados antes de la Fase 5 no tienen código
    if (!trip.delivery_code) {
        throw new AppError("NO_DELIVERY_CODE", 409);
    }
    if (trip.delivery_code_attempts >= MAX_DELIVERY_ATTEMPTS) {
        throw new AppError("DELIVERY_ATTEMPTS_EXHAUSTED", 429);
    }

    // Comparación en tiempo constante, como con los códigos de contraseña
    const isValid = crypto.timingSafeEqual(Buffer.from(data.code), Buffer.from(trip.delivery_code));
    if (!isValid) {
        await prisma.clientRequests.update({ where: { id }, data: { delivery_code_attempts: { increment: 1 } } });
        const left = MAX_DELIVERY_ATTEMPTS - trip.delivery_code_attempts - 1;
        if (left <= 0) {
            // El cliente ve en su app el botón para confirmar la entrega él mismo
            notifyUser(trip.id_client, `delivery_locked/${id}`, { id_client_request: id });
        }
        throw left > 0
            ? new AppError("WRONG_DELIVERY_CODE", 400, undefined, { count: left })
            : new AppError("WRONG_DELIVERY_CODE_LOCKED", 400);
    }
    return finishTrip(id, trip.id_client, userId, "DRIVER");
}

// Respaldo del código: el cliente confirma que recibió la carga solo si el conductor agotó los intentos
// (o en viajes de antes de la Fase 5, que no tienen código). Así nadie cierra la entrega sin la prueba
export const confirmDelivery = async (userId: number, id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id_client: true, id_driver_assigned: true, status: true, delivery_code: true, delivery_code_attempts: true }
    });
    if (!trip) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    if (trip.id_client !== userId) {
        throw deny(userId, "confirmar-entrega", `client_requests/${id}`);
    }
    if (trip.status !== "TRAVELING") {
        throw new AppError("ONLY_CONFIRM_IN_TRANSIT", 409);
    }
    if (trip.delivery_code && trip.delivery_code_attempts < MAX_DELIVERY_ATTEMPTS) {
        throw new AppError("DELIVERY_NEEDS_CODE", 409);
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
        throw new AppError("CARGO_ALREADY_PICKED_UP", 409);
    }
    if (!allowed.includes(trip.status)) {
        throw new AppError("TRIP_NOT_CANCELABLE", 409);
    }

    await prisma.$transaction(async (tx) => {
        const result = await tx.clientRequests.updateMany({
            where: { id, status: trip.status },
            data: { status: "CANCELED", canceled_by: userId, cancel_reason: data.reason }
        });
        if (result.count === 0) {
            throw new AppError("TRIP_CHANGED", 409);
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
            key: isClient ? "TRIP_CANCELED_BY_CLIENT" : "TRIP_CANCELED_BY_DRIVER", params: { reason: data.reason },
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
        throw new AppError("ONLY_RATE_FINISHED", 409);
    }

    const { count } = await prisma.clientRequests.updateMany({
        where: { id: data.id, client_rating: null },
        data: { client_rating: data.client_rating }
    });
    if (count === 0) {
        throw new AppError("CLIENT_ALREADY_RATED", 409);
    }
    return { id: data.id, client_rating: data.client_rating };
}

export const updateDriverRating = async (userId: number, data: UpdateDriverRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "calificar-conductor", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("ONLY_RATE_FINISHED", 409);
    }

    const { count } = await prisma.clientRequests.updateMany({
        where: { id: data.id, driver_rating: null },
        data: { driver_rating: data.driver_rating }
    });
    if (count === 0) {
        throw new AppError("DRIVER_ALREADY_RATED", 409);
    }
    return { id: data.id, driver_rating: data.driver_rating };
}
