import crypto from "crypto";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import { checkoutUrl, findTransaction, gatewayName, isGatewayAvailable } from "../utils/paymentGateway.js";
import { notifyUser } from "../sockets/socketHandler.js";
import { pushAmount, sendPush } from "../utils/push.js";
import { roundMoney } from "../utils/money.js";
import { checkTip, MAX_TIP_RATE, taxOnCommission } from "../utils/tax.js";
import { getCountry, getCurrency } from "./countries.service.js";
import { notifyRefund, refundExtraPayment } from "./refund.service.js";
import type { PaymentMethod } from "../generated/prisma/enums.js";

// Pago del flete: se cobra al terminar el viaje, así una cancelación nunca obliga a devolver dinero.
// En efectivo lo confirma el conductor; por la app, el cliente paga en el checkout de Wompi y el backend
// le pregunta a Wompi el resultado (sin webhook, para no exponer el PC a internet durante la demo)

const findPaymentTrip = async (id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id: true, id_client: true, id_driver_assigned: true, status: true, fare_assigned: true, commission: true, payment_method: true, paid_at: true, currency: true, country_code: true, tip: true }
    });
    if (!trip) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    return trip;
}

// Lo que se cobra: el valor acordado en la moneda del viaje, con sus decimales (COP sin centavos)
const amountOf = async (trip: { fare_assigned: number | null; currency: string }) =>
    roundMoney(trip.fare_assigned ?? 0, (await getCurrency(trip.currency)).decimals);

type PaymentTrip = Awaited<ReturnType<typeof findPaymentTrip>>;

// Propina validada con el perfil del país del flete. undefined = el cliente no la cambió: queda la que ya eligió
const validTip = async (trip: PaymentTrip, tip: number | undefined) => {
    if (tip === undefined) return trip.tip;
    const country = await getCountry(trip.country_code);
    return checkTip(tip, country.tax, trip.fare_assigned ?? 0, country.currency.decimals);
}

// Lo que se cobra en total: valor acordado + propina (la propina no paga comisión)
const totalOf = async (trip: PaymentTrip, tip: number) =>
    roundMoney((trip.fare_assigned ?? 0) + tip, (await getCurrency(trip.currency)).decimals);

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
        select: { reference: true, method: true, status: true, wompi_method: true, amount: true, created_at: true, refunded_at: true }
    });
    // El último reembolso del flete (cancelado con un pago aprobado, o un cobro de más): la app le avisa al cliente
    const refunded = await prisma.payment.findFirst({
        where: { id_client_request: trip.id, status: "REFUNDED" },
        orderBy: { refunded_at: "desc" },
        select: { amount: true, refunded_at: true }
    });
    const country = await getCountry(trip.country_code);
    return {
        id_client_request: trip.id,
        payment_method: trip.payment_method,
        paid_at: trip.paid_at,
        currency: trip.currency,
        // amount es el valor acordado del flete; total es lo que paga el cliente (con la propina)
        amount: await amountOf(trip),
        tip: trip.tip,
        total: await totalOf(trip, trip.tip),
        commission: trip.commission ?? 0,
        // Cómo se pide la propina en el país del flete: NONE (no se muestra), OPTIONAL o SUGGESTED (con porcentajes)
        tip_mode: country.tax.tip_mode,
        tip_suggestions: country.tax.tip_suggestions,
        max_tip: roundMoney((trip.fare_assigned ?? 0) * MAX_TIP_RATE, country.currency.decimals),
        // WOMPI, SIMULATOR o null si no hay pasarela para la moneda del viaje: en ese caso la app solo ofrece efectivo
        online_gateway: gatewayName(trip.currency),
        refund: refunded ? { amount: refunded.amount, refunded_at: refunded.refunded_at } : null,
        last_payment: last,
    };
}

// Marca el viaje como pagado una sola vez (el where con paid_at null evita dos pagos simultáneos) y avisa a los dos.
// Al pagar se fijan la propina y el impuesto sobre la comisión con el perfil del país de ese momento, para que el
// comprobante no cambie si luego cambian las tasas
const markPaid = async (trip: PaymentTrip, method: PaymentMethod, tip: number, idPayment?: number) => {
    const country = await getCountry(trip.country_code);
    const { count } = await prisma.clientRequests.updateMany({
        where: { id: trip.id, paid_at: null },
        data: {
            paid_at: new Date(), payment_method: method, tip,
            tax_name: country.tax.tax_name, tax_rate: country.tax.tax_rate, receipt_type: country.tax.receipt_type,
            tax_amount: taxOnCommission(trip.commission ?? 0, country.tax.tax_rate, country.currency.decimals),
        }
    });
    if (count === 0) {
        // Ya estaba pagado: este pago aprobado es un cobro doble. Queda REFUNDED con su fecha (el dinero se devuelve
        // desde la pasarela), el primer pago se respeta y el cliente lo ve en la app
        console.warn(`[pagos] el viaje ${trip.id} ya estaba pagado y llegó otro pago aprobado (${method}): se reembolsa`);
        if (idPayment) {
            await refundExtraPayment(idPayment);
            notifyRefund(trip.id_client, trip.id, { amount: await totalOf(trip, tip), currency: trip.currency });
        }
        return;
    }
    const payload = { id_client_request: trip.id, paid: true, payment_method: method, tip };
    notifyUser(trip.id_client, `trip_paid/${trip.id}`, payload);
    if (trip.id_driver_assigned) {
        notifyUser(trip.id_driver_assigned, `trip_paid/${trip.id}`, payload);
        if (method === "WOMPI") {
            void sendPush(trip.id_driver_assigned, (language) => ({
                type: "TRIP_PAID", id_client_request: trip.id, key: "TRIP_PAID", params: { amount: pushAmount((trip.fare_assigned ?? 0) + tip, trip.currency, language) },
            }));
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
    if (method === "WOMPI" && !isGatewayAvailable(trip.currency)) {
        throw new AppError("ONLINE_PAYMENTS_UNAVAILABLE", 503);
    }
    await prisma.clientRequests.update({ where: { id }, data: { payment_method: method } });
    if (trip.id_driver_assigned) {
        notifyUser(trip.id_driver_assigned, `payment_method/${id}`, { id_client_request: id, payment_method: method });
    }
    return paymentStatusOf({ ...trip, payment_method: method });
}

// El cliente elige la propina antes de pagar (en efectivo la ve el conductor al confirmar el cobro). Se valida con el
// modo del país: sin propina (NONE) solo vale 0, y nunca pasa del máximo
export const setTip = async (userId: number, id: number, tip: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "elegir-propina", `client_requests/${id}`);
    }
    if (trip.paid_at) {
        throw new AppError("TRIP_ALREADY_PAID", 409);
    }
    if (["CANCELED", "EXPIRED"].includes(trip.status)) {
        throw new AppError("TRIP_NOT_ACTIVE", 409);
    }
    const valid = await validTip(trip, tip);
    await prisma.clientRequests.update({ where: { id }, data: { tip: valid } });
    if (trip.id_driver_assigned) {
        notifyUser(trip.id_driver_assigned, `tip/${id}`, { id_client_request: id, tip: valid });
    }
    return paymentStatusOf({ ...trip, tip: valid });
}

// El cliente abre el checkout de Wompi. El monto sale del valor acordado guardado más la propina validada: nunca
// de un monto que mande la app. La propina del cuerpo es opcional; sin ella queda la que el cliente ya eligió
export const startWompiPayment = async (userId: number, id: number, requestedTip?: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "pagar", `client_requests/${id}`);
    }
    assertPayable(trip);
    if (!isGatewayAvailable(trip.currency)) {
        throw new AppError("ONLINE_PAYMENTS_UNAVAILABLE", 503);
    }

    const tip = await validTip(trip, requestedTip);
    const amount = await totalOf(trip, tip);
    // Una referencia nueva por intento: Wompi no acepta pagar dos veces la misma
    const reference = `FY-${id}-${crypto.randomBytes(5).toString("hex")}`;
    const url = checkoutUrl(reference, Math.round(amount * 100), trip.currency);

    await prisma.$transaction([
        prisma.payment.create({ data: { id_client_request: id, reference, method: "WOMPI", amount, tip, currency: trip.currency } }),
        prisma.clientRequests.update({ where: { id }, data: { payment_method: "WOMPI", tip } }),
    ]);
    return { reference, amount, tip, currency: trip.currency, checkout_url: url };
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
        const matches = tx.amount_in_cents === Math.round(payment.amount * 100) && tx.currency === payment.currency;
        const status = matches ? tx.status : "ERROR";
        if (!matches) {
            console.warn(`[pagos] la transacción ${tx.id} no coincide con la referencia ${payment.reference}`);
        }
        const { count } = await prisma.payment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status, wompi_transaction_id: tx.id, wompi_method: tx.payment_method_type ?? null }
        });
        if (count > 0 && status === "APPROVED") {
            await markPaid(trip, "WOMPI", payment.tip, payment.id);
            trip.paid_at = trip.paid_at ?? new Date();
        }
    }
    return paymentStatusOf(await findPaymentTrip(id));
}

// El conductor confirma que recibió el efectivo. Queda un registro de pago como con Wompi
// La propina es la que el cliente eligió, o la que el conductor indica si recibió otra
export const confirmCashPayment = async (userId: number, id: number, requestedTip?: number) => {
    const trip = await findPaymentTrip(id);
    if (trip.id_driver_assigned !== userId) {
        throw deny(userId, "confirmar-efectivo", `client_requests/${id}`);
    }
    assertPayable(trip);
    if (trip.payment_method !== "CASH") {
        throw new AppError("CLIENT_CHOSE_ONLINE_PAYMENT", 409);
    }

    const tip = await validTip(trip, requestedTip);
    const amount = await totalOf(trip, tip);
    await prisma.payment.create({
        data: { id_client_request: id, reference: `FY-${id}-cash-${crypto.randomBytes(3).toString("hex")}`, method: "CASH", amount, tip, currency: trip.currency, status: "APPROVED" }
    });
    await markPaid(trip, "CASH", tip);
    return paymentStatusOf(await findPaymentTrip(id));
}
