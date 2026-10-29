import prisma from "../database/prismaClient.js";

// Calificación de cada usuario: promedio de las estrellas que recibió en sus viajes terminados.
// Un conductor la recibe del cliente (driver_rating) y un cliente del conductor (client_rating)

export type RatingSummary = { average: number | null; count: number };

const NO_RATING: RatingSummary = { average: null, count: 0 };

const roundRating = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;

export const driverRatings = async (idDrivers: number[]): Promise<Map<number, RatingSummary>> => {
    const ids = [...new Set(idDrivers)];
    if (!ids.length) return new Map();
    const rows = await prisma.clientRequests.groupBy({
        by: ["id_driver_assigned"],
        where: { id_driver_assigned: { in: ids }, driver_rating: { not: null } },
        _avg: { driver_rating: true },
        _count: { driver_rating: true },
    });
    return new Map(rows.map((row) => [row.id_driver_assigned!, { average: roundRating(row._avg.driver_rating), count: row._count.driver_rating }]));
}

export const clientRatings = async (idClients: number[]): Promise<Map<number, RatingSummary>> => {
    const ids = [...new Set(idClients)];
    if (!ids.length) return new Map();
    const rows = await prisma.clientRequests.groupBy({
        by: ["id_client"],
        where: { id_client: { in: ids }, client_rating: { not: null } },
        _avg: { client_rating: true },
        _count: { client_rating: true },
    });
    return new Map(rows.map((row) => [row.id_client, { average: roundRating(row._avg.client_rating), count: row._count.client_rating }]));
}

// Quien todavía no tiene calificaciones sale como { average: null, count: 0 } y la app lo muestra como "Nuevo"
export const ratingOf = (ratings: Map<number, RatingSummary>, id: number | null | undefined): RatingSummary =>
    (id ? ratings.get(id) : undefined) ?? NO_RATING;
