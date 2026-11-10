import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";

// Reglas y verificaciones que usan todos los servicios de solicitudes de flete

// Una búsqueda "Ahora" dura 10 minutos (se reinicia si el cliente sube el precio).
// Un flete programado recibe ofertas hasta 30 minutos antes de la hora
export const SEARCH_DURATION_MS = 10 * 60 * 1000;
export const SCHEDULED_CLOSE_BEFORE_MS = 30 * 60 * 1000;

export const ACTIVE_STATUSES: ClientRequestStatus[] = ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"];

export const findTripOrFail = async (id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id: true, id_client: true, id_driver_assigned: true, status: true, fare_offered: true, currency: true, country_code: true, scheduled_at: true, expires_at: true }
    });
    if (!trip) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    return trip;
}

// Solo el cliente dueño o el conductor asignado pueden ver o tocar un viaje
export const assertTripParticipant = async (id: number, userId: number) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId && trip.id_driver_assigned !== userId) {
        throw deny(userId, "ver-viaje", `client_requests/${id}`);
    }
    return trip;
}

// Las ofertas de un viaje solo las ve el cliente que lo pidió
export const assertTripOwner = async (id: number, userId: number) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "ver-ofertas", `client_requests/${id}`);
    }
    return trip;
}
