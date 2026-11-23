import prisma from "../database/prismaClient.js";
import type { Prisma } from "../generated/prisma/client.js";
import { notifyUser } from "../sockets/socketHandler.js";

// Reembolsos (Fase 11). Un pago por la app aprobado que hay que devolver queda REFUNDED con su fecha. El dinero se
// devuelve desde Wompi (o el simulador): aquí queda el registro que ven el cliente en la app y el panel de administración

type Db = Prisma.TransactionClient | typeof prisma;

// El flete se cancela con un pago por la app ya aprobado: todos esos pagos pasan a REFUNDED y el flete queda sin pagar y
// sin comisión (FleteYa no cobra comisión de un flete que se devolvió). Devuelve cuánto se reembolsó, o null si no había pagos
export const refundTripPayments = async (db: Db, id: number) => {
    const payments = await db.payment.findMany({ where: { id_client_request: id, method: "WOMPI", status: "APPROVED" }, select: { id: true, amount: true, currency: true } });
    const first = payments[0];
    if (!first) return null;
    const now = new Date();
    await db.payment.updateMany({ where: { id: { in: payments.map((payment) => payment.id) } }, data: { status: "REFUNDED", refunded_at: now } });
    await db.clientRequests.update({
        where: { id },
        data: { paid_at: null, commission: 0, tip: 0, tax_amount: null, tax_rate: null, tax_name: null, receipt_type: null, refunded_at: now },
    });
    return { amount: payments.reduce((sum, payment) => sum + payment.amount, 0), currency: first.currency, refunded_at: now };
}

// Llegó aprobado un pago de un flete que ya estaba pagado (cobro doble): ese pago se devuelve y el primero se respeta
export const refundExtraPayment = async (idPayment: number) => {
    await prisma.payment.updateMany({ where: { id: idPayment, status: "APPROVED" }, data: { status: "REFUNDED", refunded_at: new Date() } });
}

// Avisa al cliente (sin recargar) que se le devolvió el dinero
export const notifyRefund = (idClient: number, idClientRequest: number, refund: { amount: number; currency: string }) => {
    notifyUser(idClient, `payment_refunded/${idClientRequest}`, { id_client_request: idClientRequest, amount: refund.amount, currency: refund.currency });
}
