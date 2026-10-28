import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";
import type { AssignDriverInput, CancelClientRequestInput, UpdateClientRatingInput, UpdateClientRequestInput, UpdateDriverRatingInput } from "../validators/client_request.validator.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";
import { findTripOrFail } from "./client_request.shared.js";

// Ciclo del viaje después de buscar: asignar conductor, avanzar estados, cancelar y calificar

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

    const rejectedDrivers = await prisma.$transaction(async (tx) => {
        // updateMany con status CREATED y sin vencer evita que dos aceptaciones simultáneas asignen dos conductores
        const result = await tx.clientRequests.updateMany({
            where: { id: data.id, id_client: userId, status: "CREATED", expires_at: { gt: new Date() } },
            data: {
                id_driver_assigned: data.id_driver_assigned,
                status: "ACCEPTED",
                fare_assigned: offer.fare_offered,
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

    return prisma.clientRequests.findUnique({
        where: { id: data.id },
        select: { id: true, id_client: true, id_driver_assigned: true, fare_assigned: true, status: true }
    });
}

// Estados a los que el conductor asignado puede avanzar desde cada estado. Para terminar hay que pasar por
// "Carga recogida" (TRAVELING); cancelar va por su propio endpoint
const NEXT_STATUSES: Record<string, ClientRequestStatus[]> = {
    ACCEPTED: ["ON_THE_WAY", "ARRIVED"],
    ON_THE_WAY: ["ARRIVED"],
    ARRIVED: ["TRAVELING"],
    TRAVELING: ["FINISHED"],
};

export const updateStatus = async (userId: number, data: UpdateClientRequestInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "cambiar-estado", `client_requests/${data.id}`);
    }

    const nextStatus = data.status as ClientRequestStatus;
    if (!(NEXT_STATUSES[clientRequest.status] ?? []).includes(nextStatus)) {
        throw new AppError(`No se puede pasar de ${clientRequest.status} a ${nextStatus}`, 409);
    }

    // Con el estado actual en el where, una cancelación simultánea no queda pisada por este cambio
    const result = await prisma.clientRequests.updateMany({
        where: { id: data.id, status: clientRequest.status },
        data: { status: nextStatus }
    });
    if (result.count === 0) {
        throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
    }
    return prisma.clientRequests.findUnique({ where: { id: data.id } });
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
    }
    return { id, status: "CANCELED", ...payload };
}

// El conductor califica al cliente y viceversa, y solo cuando el viaje terminó
export const updateClientRating = async (userId: number, data: UpdateClientRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "calificar-cliente", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            client_rating: data.client_rating
        }
    });

    return updatedClientRequest;
}

export const updateDriverRating = async (userId: number, data: UpdateDriverRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "calificar-conductor", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            driver_rating: data.driver_rating
        }
    });

    return updatedClientRequest;
}
