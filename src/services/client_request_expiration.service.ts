import prisma from "../database/prismaClient.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";
import { SEARCH_DURATION_MS } from "./client_request.shared.js";

// Corre cada 30 segundos desde server.ts: vence las búsquedas sin conductor y avisa al cliente y a los conductores
export const expireStaleRequests = async () => {
    const now = new Date();
    const stale = await prisma.clientRequests.findMany({
        where: {
            status: "CREATED",
            OR: [
                { expires_at: { lte: now } },
                // Solicitudes creadas antes de la Fase 3, que no tienen fecha de vencimiento
                { expires_at: null, update_at: { lte: new Date(now.getTime() - SEARCH_DURATION_MS) } }
            ]
        },
        select: { id: true, id_client: true },
        take: 200
    });

    for (const trip of stale) {
        const result = await prisma.clientRequests.updateMany({
            where: { id: trip.id, status: "CREATED" },
            data: { status: "EXPIRED" }
        });
        if (result.count === 0) continue;
        await prisma.driverTripOffer.updateMany({
            where: { id_client_request: trip.id, status: "PENDING" },
            data: { status: "EXPIRED" }
        });
        notifyUser(trip.id_client, `client_request_expired/${trip.id}`, { id_client_request: trip.id });
        notifyDrivers("client_request_removed", { id_client_request: trip.id });
    }
    if (stale.length) console.log(`[expiracion] ${stale.length} solicitudes vencidas`);
}
