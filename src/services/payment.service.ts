import crypto from "crypto";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import { CURRENCY, checkoutUrl, findTransaction, gatewayName, isGatewayAvailable } from "../utils/paymentGateway.js";
import { notifyUser } from "../sockets/socketHandler.js";
import { formatPesos, sendPush } from "../utils/push.js";
import type { PaymentMethod } from "../generated/prisma/enums.js";

// Pago del flete: se cobra al terminar el viaje, así una cancelación nunca obliga a devolver dinero.
// En efectivo lo confirma el conductor; por la app, el cliente paga en el checkout de Wompi y el backend
// le pregunta a Wompi el resultado (sin webhook, para no exponer el PC a internet durante la demo)

const findPaymentTrip = async (id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id: true, id_client: true, id_driver_assigned: true, status: true, fare_assigned: true, commission: true, payment_method: true, paid_at: true }
    });
    if (!trip) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    return trip;
}

type PaymentTrip = Awaited<ReturnType<typeof findPaymentTrip>>;

const assertPayable = (trip: PaymentTrip) => {
    if (trip.status !== "FINISHED") {
        throw new AppError("PAY_AFTER_DELIVERY", 409);
    }
    if (trip.paid_at) {
        throw new AppError("TRIP_ALREADY_PAID", 409);
    }
}

// Lo que ven el cliente y el conductor del pago: método, si ya se pagó y el último intento por la app
export const getPaymentStatus = async (userId: number, id: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId && trip.id_driver_assigned !== userId) {
        throw deny(userId, "ver-pago", `client_requests/${id}`);
    }
    return paymentStatusOf(trip);
}

const paymentStatusOf = async (trip: PaymentTrip) => {
    const last = await prisma.payment.findFirst({
        where: { id_client_request: trip.id },
        orderBy: { created_at: "desc" },
        select: { reference: true, method: true, status: true, wompi_method: true, amount: true, created_at: true }
    });
    return {
        id_client_request: trip.id,
        payment_method: trip.payment_method,
        paid_at: trip.paid_at,
        amount: Math.round(trip.fare_assigned ?? 0),
        commission: trip.commission ?? 0,
        // WOMPI, SIMULATOR o null si no hay pasarela: en ese caso la app solo ofrece efectivo
        online_gateway: gatewayName(),
        last_payment: last,
    };
}

// Marca el viaje como pagado una sola vez (el where con paid_at null evita dos pagos simultáneos) y avisa a los dos
const markPaid = async (trip: PaymentTrip, method: PaymentMethod, label: string) => {
    const { count } = await prisma.clientRequests.updateMany({
        where: { id: trip.id, paid_at: null },
        data: { paid_at: new Date(), payment_method: method }
    });
    if (count === 0) {
        // Ya estaba pagado: si este pago también se aprobó, hay un cobro doble que hay que devolver a mano
        console.warn(`[pagos] el viaje ${trip.id} ya estaba pagado y llegó otro pago aprobado (${method})`);
        return;
    }
    const payload = { id_client_request: trip.id, paid: true, payment_method: method };
    notifyUser(trip.id_client, `trip_paid/${trip.id}`, payload);
    if (trip.id_driver_assigned) {
        notifyUser(trip.id_driver_assigned, `trip_paid/${trip.id}`, payload);
        if (method === "WOMPI") {
            void sendPush(trip.id_driver_assigned, {
                type: "TRIP_PAID", id_client_request: trip.id, key: "TRIP_PAID", params: { amount: formatPesos(trip.fare_assigned ?? 0) },
            });
        }
    }
}

// El cliente elige cómo pagar mientras el flete no esté pagado (por ejemplo, pasa a efectivo si Wompi le rechaza la tarjeta)
export const changePaymentMethod = async (userId: number, id: number, method: PaymentMethod) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "cambiar-metodo-pago", `client_requests/${id}`);
    }
    if (trip.paid_at) {
        throw new AppError("TRIP_ALREADY_PAID", 409);
    }
    if (["CANCELED", "EXPIRED"].includes(trip.status)) {
        throw new AppError("TRIP_NOT_ACTIVE", 409);
    }
    if (method === "WOMPI" && !isGatewayAvailable()) {
        throw new AppError("ONLINE_PAYMENTS_UNAVAILABLE", 503);
    }
    await prisma.clientRequests.update({ where: { id }, data: { payment_method: method } });
    if (trip.id_driver_assigned) {
        notifyUser(trip.id_driver_assigned, `payment_method/${id}`, { id_client_request: id, payment_method: method });
    }
    return paymentStatusOf({ ...trip, payment_method: method });
}

// El cliente abre el checkout de Wompi. El monto sale del valor acordado guardado, nunca de lo que mande la app
export const startWompiPayment = async (userId: number, id: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "pagar", `client_requests/${id}`);
    }
    assertPayable(trip);
    if (!isGatewayAvailable()) {
        throw new AppError("ONLINE_PAYMENTS_UNAVAILABLE", 503);
    }

    const amount = Math.round(trip.fare_assigned ?? 0);
    // Una referencia nueva por intento: Wompi no acepta pagar dos veces la misma
    const reference = `FY-${id}-${crypto.randomBytes(5).toString("hex")}`;
    const url = checkoutUrl(reference, amount * 100);

    await prisma.$transaction([
        prisma.payment.create({ data: { id_client_request: id, reference, method: "WOMPI", amount } }),
        prisma.clientRequests.update({ where: { id }, data: { payment_method: "WOMPI" } }),
    ]);
    return { reference, amount, checkout_url: url };
}

// Pregunta a Wompi por los intentos pendientes del viaje y guarda lo que responda. La llaman el cliente al volver
// del checkout y el conductor mientras espera; si nadie paga, los intentos quedan pendientes sin hacer daño
export const verifyWompiPayments = async (userId: number, id: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId && trip.id_driver_assigned !== userId) {
        throw deny(userId, "verificar-pago", `client_requests/${id}`);
    }
    const pending = await prisma.payment.findMany({
        where: { id_client_request: id, method: "WOMPI", status: "PENDING" },
        orderBy: { created_at: "desc" },
        take: 5
    });

    for (const payment of pending) {
        const tx = await findTransaction(payment.reference);
        if (!tx || tx.status === "PENDING") continue;

        // Si Wompi responde otro monto o moneda, alguien alteró el pago: no se da por bueno
        const matches = tx.amount_in_cents === payment.amount * 100 && tx.currency === CURRENCY;
        const status = matches ? tx.status : "ERROR";
        if (!matches) {
            console.warn(`[pagos] la transacción ${tx.id} no coincide con la referencia ${payment.reference}`);
        }
        const { count } = await prisma.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status, wompi_transaction_id: tx.id, wompi_method: tx.payment_method_type ?? null }
        });
        if (count > 0 && status === "APPROVED") {
            await markPaid(trip, "WOMPI", "por la app");
            trip.paid_at = trip.paid_at ?? new Date();
        }
    }
    return paymentStatusOf(await findPaymentTrip(id));
}

// El conductor confirma que recibió el efectivo. Queda un registro de pago como con Wompi
export const confirmCashPayment = async (userId: number, id: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_driver_assigned !== userId) {
        throw deny(userId, "confirmar-efectivo", `client_requests/${id}`);
    }
    assertPayable(trip);
    if (trip.payment_method !== "CASH") {
        throw new AppError("CLIENT_CHOSE_ONLINE_PAYMENT", 409);
    }

    const amount = Math.round(trip.fare_assigned ?? 0);
    await prisma.payment.create({
        data: { id_client_request: id, reference: `FY-${id}-cash-${crypto.randomBytes(3).toString("hex")}`, method: "CASH", amount, status: "APPROVED" }
    });
    await markPaid(trip, "CASH", "en efectivo");
    return paymentStatusOf(await findPaymentTrip(id));
}
