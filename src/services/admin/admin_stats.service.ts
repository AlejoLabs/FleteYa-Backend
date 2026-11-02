import prisma from "../../database/prismaClient.js";

// Cifras del inicio del panel para los últimos N días. Las fechas se agrupan en hora de Colombia (UTC-5)

const DAY_MS = 24 * 60 * 60 * 1000;
const COLOMBIA_OFFSET = "-05:00";

const num = (value: unknown) => Number(value ?? 0);

export const getStats = async (days: number) => {
    const since = new Date(Date.now() - days * DAY_MS);

    const [
        clients, drivers, newUsers, suspended,
        approvals, availableNow,
        byStatus, perDay, cancelReasons, assignTime, fareByVehicle, commission, cashPending,
    ] = await Promise.all([
        prisma.userHasRole.count({ where: { id_rol: "CLIENT", user: { anonymized_at: null } } }),
        prisma.userHasRole.count({ where: { id_rol: "DRIVER", user: { anonymized_at: null } } }),
        prisma.user.count({ where: { created_at: { gte: since }, anonymized_at: null } }),
        prisma.user.count({ where: { status: "SUSPENDED" } }),
        prisma.driverCarInfo.groupBy({ by: ["approval_status"], _count: { _all: true } }),
        prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM drivers_position`,
        prisma.clientRequests.groupBy({ by: ["status"], where: { created_at: { gte: since } }, _count: { _all: true } }),
        prisma.$queryRaw<{ day: Date; created: bigint; finished: bigint }[]>`
            SELECT DATE(CONVERT_TZ(created_at, '+00:00', ${COLOMBIA_OFFSET})) AS day,
                   COUNT(*) AS created,
                   SUM(status = 'FINISHED') AS finished
            FROM client_requests
            WHERE created_at >= ${since}
            GROUP BY day ORDER BY day`,
        prisma.clientRequests.groupBy({
            by: ["cancel_reason"], where: { status: "CANCELED", update_at: { gte: since } },
            _count: { _all: true }, orderBy: { _count: { cancel_reason: "desc" } }, take: 6,
        }),
        // Desde que se publica un flete inmediato hasta que el cliente acepta una oferta
        prisma.$queryRaw<{ minutes: number | null }[]>`
            SELECT AVG(TIMESTAMPDIFF(SECOND, CR.created_at, O.update_at)) / 60 AS minutes
            FROM client_requests AS CR
            INNER JOIN driver_trip_offers AS O ON O.id_client_request = CR.id AND O.status = 'ACCEPTED'
            WHERE CR.created_at >= ${since} AND CR.scheduled_at IS NULL`,
        prisma.$queryRaw<{ vehicle: string; trips: bigint; avg_fare: number }[]>`
            SELECT required_vehicle AS vehicle, COUNT(*) AS trips, AVG(COALESCE(fare_assigned, fare_offered)) AS avg_fare
            FROM client_requests
            WHERE status = 'FINISHED' AND update_at >= ${since}
            GROUP BY required_vehicle`,
        prisma.clientRequests.aggregate({
            where: { paid_at: { gte: since } }, _sum: { commission: true, fare_assigned: true }, _count: { _all: true },
        }),
        prisma.clientRequests.aggregate({
            where: { payment_method: "CASH", paid_at: { not: null }, commission_settled_at: null }, _sum: { commission: true },
        }),
    ]);

    const approvalCount = (status: string) => approvals.find((row) => row.approval_status === status)?._count._all ?? 0;

    return {
        days,
        users: { clients, drivers, new_users: newUsers, suspended },
        drivers: {
            approved: approvalCount("APPROVED"), pending: approvalCount("PENDING"), rejected: approvalCount("REJECTED"),
            available_now: num(availableNow[0]?.n),
        },
        trips: {
            by_status: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
            per_day: perDay.map((row) => ({ day: row.day, created: num(row.created), finished: num(row.finished) })),
            cancel_reasons: cancelReasons.map((row) => ({ reason: row.cancel_reason ?? "Sin motivo", count: row._count._all })),
            avg_minutes_to_driver: assignTime[0]?.minutes === null || assignTime[0]?.minutes === undefined ? null : Math.round(num(assignTime[0].minutes) * 10) / 10,
            fare_by_vehicle: fareByVehicle.map((row) => ({ vehicle: row.vehicle, trips: num(row.trips), avg_fare: Math.round(num(row.avg_fare)) })),
        },
        money: {
            paid_trips: commission._count._all,
            paid_volume: Math.round(num(commission._sum.fare_assigned)),
            commission: Math.round(num(commission._sum.commission)),
            cash_commission_pending: Math.round(num(cashPending._sum.commission)),
        },
    };
}
