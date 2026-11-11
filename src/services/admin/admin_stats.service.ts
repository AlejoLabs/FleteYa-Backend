import prisma from "../../database/prismaClient.js";
import { convertAmount } from "../exchange/exchangeRates.js";
import { exchangeRates } from "../exchange/index.js";

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
        // El promedio por vehículo, en cada moneda: un promedio de pesos con euros no dice nada
        prisma.$queryRaw<{ vehicle: string; currency: string; trips: bigint; avg_fare: number }[]>`
            SELECT required_vehicle AS vehicle, currency, COUNT(*) AS trips, AVG(COALESCE(fare_assigned, fare_offered)) AS avg_fare
            FROM client_requests
            WHERE status = 'FINISHED' AND update_at >= ${since}
            GROUP BY required_vehicle, currency`,
        prisma.clientRequests.groupBy({
            by: ["currency"], where: { paid_at: { gte: since } }, _sum: { commission: true, fare_assigned: true }, _count: { _all: true },
        }),
        prisma.clientRequests.groupBy({
            by: ["currency"], where: { payment_method: "CASH", paid_at: { not: null }, commission_settled_at: null }, _sum: { commission: true },
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
            fare_by_vehicle: fareByVehicle.map((row) => ({ vehicle: row.vehicle, currency: row.currency, trips: num(row.trips), avg_fare: num(row.avg_fare) })),
        },
        money: await moneyByCurrency(commission, cashPending),
    };
}

type PaidRow = { currency: string; _sum: { commission: number | null; fare_assigned: number | null }; _count: { _all: number } };
type PendingRow = { currency: string; _sum: { commission: number | null } };

// Cada moneda por separado y, aparte, un total aproximado en dólares con el tipo de cambio de referencia
// (dice de qué fecha es la tasa y si es la última guardada porque la fuente no respondió)
const moneyByCurrency = async (paid: PaidRow[], pending: PendingRow[]) => {
    const currencies = [...new Set([...paid.map((row) => row.currency), ...pending.map((row) => row.currency)])].sort();
    const byCurrency = currencies.map((currency) => {
        const p = paid.find((row) => row.currency === currency);
        return {
            currency,
            paid_trips: p?._count._all ?? 0,
            paid_volume: num(p?._sum.fare_assigned),
            commission: num(p?._sum.commission),
            cash_commission_pending: num(pending.find((row) => row.currency === currency)?._sum.commission),
        };
    });
    const snapshot = await exchangeRates.getRates();
    const usd = (field: "paid_volume" | "commission" | "cash_commission_pending") => {
        let total = 0;
        for (const row of byCurrency) {
            const value = convertAmount(row[field], row.currency, "USD", snapshot.rates);
            if (value === null) return null;
            total += value;
        }
        return Math.round(total * 100) / 100;
    };
    const used = byCurrency.map((row) => snapshot.rates[row.currency]).filter(Boolean);
    return {
        by_currency: byCurrency,
        approx_usd: {
            paid_volume: usd("paid_volume"),
            commission: usd("commission"),
            cash_commission_pending: usd("cash_commission_pending"),
            // La tasa más vieja que se usó y si alguna salió del respaldo
            rate_date: used.map((rate) => rate!.rate_date).sort()[0] ?? null,
            stale: used.some((rate) => rate!.stale),
        },
        exchange_sources: snapshot.sources,
    };
}
