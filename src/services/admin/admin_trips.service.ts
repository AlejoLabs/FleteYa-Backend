import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { notifyDrivers, notifyUser } from "../../sockets/socketHandler.js";
import { sendPush } from "../../utils/push.js";
import type { ClientRequestStatus } from "../../generated/prisma/enums.js";
import { logAdminAction } from "./admin_audit.service.js";

// Viajes en el panel: todos con su estado, el detalle de cada uno y cerrar los que quedaron atascados

const PAGE_SIZE = 25;
const OPEN: ClientRequestStatus[] = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"];
// Un viaje abierto sin cambios en este tiempo se marca como atascado
export const STUCK_HOURS = 6;

const person = { select: { id: true, name: true, lastname: true, email: true } } as const;
const nameOf = (user: { name: string; lastname: string } | null) => (user ? `${user.name} ${user.lastname}`.trim() : null);

export const listTrips = async (filters: { status?: ClientRequestStatus | undefined; stuck?: boolean; q?: string | undefined; page: number }) => {
    const q = filters.q?.trim();
    const stuckLimit = new Date(Date.now() - STUCK_HOURS * 60 * 60 * 1000);
    const where = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.stuck ? { status: { in: OPEN }, update_at: { lt: stuckLimit } } : {}),
        ...(q ? {
            OR: [
                ...(Number.isInteger(Number(q)) ? [{ id: Number(q) }] : []),
                { pickup_description: { contains: q } }, { destination_description: { contains: q } },
                { client: { email: { contains: q } } }, { driver: { email: { contains: q } } },
            ],
        } : {}),
    };
    const [total, trips] = await Promise.all([
        prisma.clientRequests.count({ where }),
        prisma.clientRequests.findMany({
            where, orderBy: { id: "desc" }, skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE,
            select: {
                id: true, status: true, fare_offered: true, fare_assigned: true, payment_method: true, paid_at: true,
                required_vehicle: true, cargo_category: true, scheduled_at: true, created_at: true, update_at: true,
                pickup_description: true, destination_description: true,
                client: person, driver: person,
            },
        }),
    ]);
    return {
        total, page: filters.page, page_size: PAGE_SIZE, stuck_hours: STUCK_HOURS,
        items: trips.map((trip) => ({
            ...trip,
            client: nameOf(trip.client), driver: nameOf(trip.driver),
            stuck: OPEN.includes(trip.status) && trip.update_at < stuckLimit,
        })),
    };
}

export const getTripDetail = async (id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: {
            id: true, status: true, fare_offered: true, fare_assigned: true, commission: true, commission_rate: true,
            payment_method: true, paid_at: true, commission_settled_at: true, declared_value: true,
            pickup_description: true, destination_description: true, cargo_description: true, cargo_category: true,
            required_vehicle: true, weight_kg: true, packages: true, helpers: true, scheduled_at: true,
            canceled_by: true, cancel_reason: true, client_rating: true, driver_rating: true,
            delivery_code_attempts: true, created_at: true, update_at: true,
            client: person, driver: person,
            driverTripOffers: { orderBy: { id: "asc" }, select: { id: true, id_driver: true, fare_offered: true, status: true, created_at: true, driver: { select: { name: true, lastname: true } } } },
            payments: { orderBy: { id: "asc" }, select: { id: true, reference: true, method: true, amount: true, status: true, wompi_method: true, created_at: true } },
            incidents: { select: { id: true, kind: true, status: true, created_at: true } },
            _count: { select: { messages: true, photos: true } },
        },
    });
    if (!trip) {
        throw new AppError("El viaje no existe", 404);
    }
    const { driverTripOffers, _count, client, driver, ...rest } = trip;
    return {
        ...rest,
        client: client && { id: client.id, name: nameOf(client), email: client.email },
        driver: driver && { id: driver.id, name: nameOf(driver), email: driver.email },
        offers: driverTripOffers.map((offer) => ({ ...offer, driver: nameOf(offer.driver) })),
        messages: _count.messages, photos: _count.photos,
    };
}

// El admin cierra un viaje que quedó abierto (la app se cerró, nadie lo terminó). Les avisa a los dos
export const cancelTrip = async (adminId: number, id: number, reason: string) => {
    const trip = await prisma.clientRequests.findUnique({ where: { id }, select: { status: true, id_client: true, id_driver_assigned: true } });
    if (!trip) {
        throw new AppError("El viaje no existe", 404);
    }
    if (!OPEN.includes(trip.status)) {
        throw new AppError("Este viaje ya está cerrado", 409);
    }
    await prisma.$transaction(async (tx) => {
        const result = await tx.clientRequests.updateMany({
            where: { id, status: trip.status },
            data: { status: "CANCELED", canceled_by: adminId, cancel_reason: `FleteYa: ${reason}` },
        });
        if (result.count === 0) {
            throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
        }
        await tx.driverTripOffer.updateMany({ where: { id_client_request: id, status: "PENDING" }, data: { status: "EXPIRED" } });
        await logAdminAction(tx, adminId, "CANCEL_TRIP", "trip", id, reason);
    });

    const payload = { id_client_request: id, canceled_by: "ADMIN", reason };
    if (trip.status === "CREATED") notifyDrivers("client_request_removed", { id_client_request: id });
    for (const userId of [trip.id_client, trip.id_driver_assigned]) {
        if (!userId) continue;
        notifyUser(userId, `trip_canceled/${id}`, payload);
        void sendPush(userId, { type: "TRIP_CANCELED", id_client_request: id, title: "FleteYa cerró el flete", body: `Motivo: ${reason}` });
    }
    return { id, status: "CANCELED" };
}
