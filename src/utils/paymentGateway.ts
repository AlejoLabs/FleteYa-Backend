import crypto from "crypto";
import * as wompi from "./wompi.js";
import type { WompiStatus, WompiTransaction } from "./wompi.js";

// Pasarela de pagos que usa el backend: Wompi si están sus llaves en el .env; si no, y PAYMENTS_SIMULATOR=true,
// un simulador propio con la misma forma (checkout web + consulta por referencia). Así la app y el servicio de pagos
// no cambian al pasar del simulador a Wompi: solo se ponen las llaves.
// Activar el comercio en Wompi pide RUT y cuenta bancaria; para la demo basta el simulador

const simulatorEnabled = () => !wompi.isWompiConfigured() && process.env.PAYMENTS_SIMULATOR === "true";

// Wompi solo cobra en pesos colombianos; el simulador acepta la moneda de cualquier país.
// Sin pasarela para esa moneda, la app solo ofrece efectivo
export const gatewayName = (currency: string) => wompi.isWompiConfigured()
    ? (currency === wompi.CURRENCY ? "WOMPI" : null)
    : simulatorEnabled() ? "SIMULATOR" : null;

export const isGatewayAvailable = (currency: string) => gatewayName(currency) !== null;

// Intentos del simulador por referencia. Viven en memoria: si el backend se reinicia, el intento queda pendiente
// y el cliente vuelve a pagar con una referencia nueva
interface SimulatedPayment {
    amount_in_cents: number;
    currency: string;
    // Desde que el cliente envía el formulario hasta resolve_at el pago está "procesando", como en una pasarela real
    processing?: { status: WompiStatus; method: string; description: string; resolve_at: number };
    // "Visa •••• 4242", "Nequi •••• 1111": para el comprobante, nunca el número completo
    description?: string;
    transaction?: WompiTransaction;
    created_at: Date;
}
const simulated = new Map<string, SimulatedPayment>();

const PROCESSING_MS = 2500;

// Pasado el tiempo de proceso, el intento queda aprobado o rechazado
const settle = (reference: string, payment: SimulatedPayment) => {
    if (!payment.processing || payment.transaction || Date.now() < payment.processing.resolve_at) return;
    payment.description = payment.processing.description;
    payment.transaction = {
        id: `sim-${crypto.randomBytes(6).toString("hex")}`,
        status: payment.processing.status,
        reference,
        amount_in_cents: payment.amount_in_cents,
        currency: payment.currency,
        payment_method_type: payment.processing.method,
    };
}

// amountInCents: el monto en la unidad más pequeña de la moneda (centavos), como lo pide Wompi
export const checkoutUrl = (reference: string, amountInCents: number, currency: string) => {
    if (wompi.isWompiConfigured()) {
        return wompi.checkoutUrl(reference, amountInCents);
    }
    simulated.set(reference, { amount_in_cents: amountInCents, currency, created_at: new Date() });
    return `http://${process.env.HOST}:${process.env.PORT}/payments/simulator/${encodeURIComponent(reference)}`;
}

export const findTransaction = async (reference: string): Promise<WompiTransaction | null> => {
    if (wompi.isWompiConfigured()) {
        return wompi.findTransaction(reference);
    }
    const payment = simulated.get(reference);
    if (!payment) return null;
    settle(reference, payment);
    return payment.transaction ?? null;
}

// Lo usa la página del simulador
export const getSimulatedPayment = (reference: string) => {
    const payment = simulatorEnabled() ? simulated.get(reference) : undefined;
    if (!payment) return null;
    settle(reference, payment);
    return payment;
}

// El cliente envió el formulario con datos de prueba válidos. Un intento solo se procesa una vez
export const startSimulatedPayment = (reference: string, status: WompiStatus, method: string, description: string) => {
    const payment = getSimulatedPayment(reference);
    if (!payment || payment.processing) return false;
    payment.processing = { status, method, description, resolve_at: Date.now() + PROCESSING_MS };
    return true;
}

