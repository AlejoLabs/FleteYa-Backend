import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { formatPesos } from "../../utils/push.js";
import { logAdminAction } from "./admin_audit.service.js";

// Pagos y comisiones. Por la app, FleteYa recibe el pago y la comisión se queda sola. En efectivo, el conductor
// recibe todo y le debe la comisión a FleteYa: el admin la marca como liquidada cuando el conductor la entrega

const PAGE_SIZE = 25;

export const listPayments = async (page: number) => {
    const [total, rows] = await Promise.all([
        prisma.payment.count(),
        prisma.payment.findMany({
            orderBy: { id: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
            select: {
                id: true, reference: true, method: true, amount: true, status: true, wompi_method: true, created_at: true,
                clientRequest: { select: { id: true, commission: true, client: { select: { name: true, lastname: true } } } },
            },
        }),
    ]);
    return {
        total, page, page_size: PAGE_SIZE,
        items: rows.map((row) => ({
            id: row.id, reference: row.reference, method: row.method, amount: row.amount, status: row.status,
            channel: row.wompi_method, created_at: row.created_at,
            id_client_request: row.clientRequest.id, commission: row.clientRequest.commission,
            client: `${row.clientRequest.client.name} ${row.clientRequest.client.lastname}`.trim(),
        })),
    };
}

// Lo que cada conductor debe de sus viajes en efectivo, el que más debe primero
export const listCashCommissions = async () => {
    const rows = await prisma.clientRequests.groupBy({
        by: ["id_driver_assigned"],
        where: { payment_method: "CASH", paid_at: { not: null }, commission_settled_at: null, id_driver_assigned: { not: null } },
        _sum: { commission: true, fare_assigned: true },
        _count: { _all: true },
        _min: { paid_at: true },
    });
    const drivers = await prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.id_driver_assigned!) } },
        select: { id: true, name: true, lastname: true, email: true },
    });
    return rows
        .map((row) => {
            const driver = drivers.find((user) => user.id === row.id_driver_assigned)!;
            return {
                id_driver: row.id_driver_assigned!, name: `${driver.name} ${driver.lastname}`.trim(), email: driver.email,
                trips: row._count._all, collected: Math.round(row._sum.fare_assigned ?? 0),
                owed: Math.round(row._sum.commission ?? 0), oldest: row._min.paid_at,
            };
        })
        .sort((a, b) => b.owed - a.owed);
}

// El conductor entregó la comisión de todos sus viajes en efectivo pendientes hasta ahora
export const settleCashCommission = async (adminId: number, idDriver: number) => {
    const where = { id_driver_assigned: idDriver, payment_method: "CASH" as const, paid_at: { not: null }, commission_settled_at: null };
    const pending = await prisma.clientRequests.aggregate({ where, _sum: { commission: true }, _count: { _all: true } });
    if (pending._count._all === 0) {
        throw new AppError("Este conductor no tiene comisiones pendientes", 409);
    }
    const amount = Math.round(pending._sum.commission ?? 0);
    await prisma.$transaction(async (tx) => {
        await tx.clientRequests.updateMany({ where, data: { commission_settled_at: new Date() } });
        await logAdminAction(tx, adminId, "SETTLE_COMMISSION", "driver", idDriver, `${pending._count._all} viajes · ${formatPesos(amount)}`);
    });
    return { id_driver: idDriver, trips: pending._count._all, amount };
}
