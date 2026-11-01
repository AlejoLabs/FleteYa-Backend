import crypto from "crypto";
import axios from "axios";
import { AppError } from "./App.Error.js";

// Wompi (pasarela colombiana): la app abre su checkout web y el backend le pregunta el resultado con la llave privada.
// Las llaves de prueba (pub_test_, prv_test_) usan el ambiente sandbox: ahí no se mueve dinero real.
// Van en el .env: WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY y WOMPI_INTEGRITY_SECRET

const CHECKOUT_URL = "https://checkout.wompi.co/p/";
export const CURRENCY = "COP";

export type WompiStatus = "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "ERROR";

export interface WompiTransaction {
    id: string;
    status: WompiStatus;
    reference: string;
    amount_in_cents: number;
    currency: string;
    payment_method_type?: string;
}

const keys = () => {
    const publicKey = process.env.WOMPI_PUBLIC_KEY;
    const privateKey = process.env.WOMPI_PRIVATE_KEY;
    const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
    if (!publicKey || !privateKey || !integritySecret) {
        throw new AppError("Los pagos por la app no están disponibles en este momento. Paga en efectivo al conductor", 503);
    }
    return { publicKey, privateKey, integritySecret };
}

const apiUrl = (publicKey: string) => publicKey.startsWith("pub_test_")
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";

export const isWompiConfigured = () =>
    Boolean(process.env.WOMPI_PUBLIC_KEY && process.env.WOMPI_PRIVATE_KEY && process.env.WOMPI_INTEGRITY_SECRET);

// Link del checkout web. La firma de integridad impide que alguien cambie el monto o la referencia en el link
export const checkoutUrl = (reference: string, amountInCents: number) => {
    const { publicKey, integritySecret } = keys();
    const signature = crypto.createHash("sha256")
        .update(`${reference}${amountInCents}${CURRENCY}${integritySecret}`)
        .digest("hex");
    const params = new URLSearchParams({
        "public-key": publicKey,
        currency: CURRENCY,
        "amount-in-cents": String(amountInCents),
        reference,
        "signature:integrity": signature,
    });
    return `${CHECKOUT_URL}?${params.toString()}`;
}

// La transacción más reciente con esa referencia, o null si el cliente todavía no pagó en el checkout
export const findTransaction = async (reference: string): Promise<WompiTransaction | null> => {
    const { publicKey, privateKey } = keys();
    try {
        const response = await axios.get(`${apiUrl(publicKey)}/transactions`, {
            params: { reference },
            headers: { Authorization: `Bearer ${privateKey}` },
            timeout: 10000,
        });
        const transactions: WompiTransaction[] = response.data?.data ?? [];
        if (!transactions.length) return null;
        // Si hubo varios intentos con la misma referencia, gana el aprobado; si no, el último
        return transactions.find((tx) => tx.status === "APPROVED") ?? transactions[transactions.length - 1]!;
    } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        console.error(`[wompi] no se pudo consultar la referencia ${reference} (HTTP ${status ?? "sin respuesta"})`);
        throw new AppError("No pudimos consultar el pago con Wompi. Intenta de nuevo en un momento", 502);
    }
}
