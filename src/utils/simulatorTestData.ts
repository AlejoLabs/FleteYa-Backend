import type { WompiStatus } from "./wompi.js";

// Datos que acepta el simulador de pagos, los mismos que publica Wompi para su sandbox. Cualquier otro dato se rechaza
// con un aviso: así el simulador nunca recibe ni guarda una tarjeta o un celular reales

export const TEST_CARDS: Record<string, WompiStatus> = {
    "4242424242424242": "APPROVED",
    "4111111111111111": "DECLINED",
};

export const TEST_NEQUI: Record<string, WompiStatus> = {
    "3991111111": "APPROVED",
    "3992222222": "DECLINED",
};

export const TEST_BANKS: { code: string; name: string; status: WompiStatus }[] = [
    { code: "1", name: "Banco de pruebas que aprueba", status: "APPROVED" },
    { code: "2", name: "Banco de pruebas que rechaza", status: "DECLINED" },
];

export type SimulatorMethod = "CARD" | "NEQUI" | "PSE";

export type SimulatorResult =
    | { ok: true; status: WompiStatus; method: SimulatorMethod; description: string }
    | { ok: false; method: SimulatorMethod; error: string };

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

const luhn = (number: string) => {
    let sum = 0;
    for (let i = 0; i < number.length; i++) {
        let digit = Number(number[number.length - 1 - i]);
        if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
        sum += digit;
    }
    return sum % 10 === 0;
}

const cardBrand = (number: string) => number.startsWith("4") ? "Visa" : /^5[1-5]/.test(number) ? "Mastercard" : "Tarjeta";

// "MM/AA" vigente
const validExpiry = (value: unknown) => {
    const match = String(value ?? "").trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!match) return false;
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    if (month < 1 || month > 12) return false;
    const now = new Date();
    return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

const card = (body: any): SimulatorResult => {
    const number = digits(body.card_number);
    const fail = (error: string): SimulatorResult => ({ ok: false, method: "CARD", error });
    if (number.length < 13 || number.length > 19 || !luhn(number)) return fail("El número de la tarjeta no es válido");
    if (!validExpiry(body.expiry)) return fail("Revisa la fecha de vencimiento (MM/AA)");
    if (!/^\d{3,4}$/.test(String(body.cvc ?? ""))) return fail("El código de seguridad tiene 3 o 4 dígitos");
    if (String(body.holder ?? "").trim().length < 3) return fail("Escribe el nombre como aparece en la tarjeta");
    const status = TEST_CARDS[number];
    if (!status) return fail("Esta es una pasarela de prueba: usa una de las tarjetas de prueba de la lista");
    return { ok: true, status, method: "CARD", description: `${cardBrand(number)} •••• ${number.slice(-4)}` };
}

const nequi = (body: any): SimulatorResult => {
    const phone = digits(body.phone);
    if (!/^3\d{9}$/.test(phone)) return { ok: false, method: "NEQUI", error: "El celular tiene 10 dígitos y empieza por 3" };
    const status = TEST_NEQUI[phone];
    if (!status) return { ok: false, method: "NEQUI", error: "Esta es una pasarela de prueba: usa uno de los celulares de prueba de la lista" };
    return { ok: true, status, method: "NEQUI", description: `Nequi •••• ${phone.slice(-4)}` };
}

const pse = (body: any): SimulatorResult => {
    const fail = (error: string): SimulatorResult => ({ ok: false, method: "PSE", error });
    const bank = TEST_BANKS.find((item) => item.code === String(body.bank ?? ""));
    if (!["NATURAL", "JURIDICA"].includes(String(body.person_type))) return fail("Elige el tipo de persona");
    if (!bank) return fail("Elige un banco de la lista");
    if (!["CC", "CE", "NIT"].includes(String(body.document_type))) return fail("Elige el tipo de documento");
    if (!/^\d{5,15}$/.test(digits(body.document))) return fail("El número de documento tiene entre 5 y 15 dígitos");
    return { ok: true, status: bank.status, method: "PSE", description: `PSE · ${bank.name}` };
}

// Valida el formulario del medio elegido y dice cómo termina el pago
export const evaluateSimulatorForm = (body: any): SimulatorResult => {
    if (body.method === "NEQUI") return nequi(body);
    if (body.method === "PSE") return pse(body);
    return card(body);
}
