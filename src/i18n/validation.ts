import { hasKey, t, type Params } from "./index.js";

// Los mensajes de zod son códigos ("NAME_REQUIRED"). Si el mensaje trae datos variables se escribe
// vm("FARE_MIN", { field: "@fields.fare_offered", min: "$5.000" }); un dato que empieza con "@" es la clave de otro texto
export const vm = (key: string, params?: Params) => (params ? `${key}|${JSON.stringify(params)}` : key);

export interface ValidationMessage { key: string; params?: Params }

// Devuelve el código si el mensaje de zod es uno nuestro; null si es un mensaje cualquiera de zod
export const parseValidationMessage = (message: string): ValidationMessage | null => {
    const [key, json] = message.split(/\|(.*)/s);
    if (!key || !/^[A-Z0-9_]+$/.test(key) || !hasKey(`errors.${key}`)) return null;
    let params: Params | undefined;
    if (json) { try { params = JSON.parse(json); } catch { params = undefined; } }
    return params ? { key, params } : { key };
}

// Los datos que empiezan con "@" son claves de otros textos (el nombre de un campo): se traducen al idioma pedido
export const resolveParams = (language: string, params?: Params): Params | undefined => {
    if (!params) return undefined;
    return Object.fromEntries(Object.entries(params).map(([name, value]) =>
        [name, typeof value === "string" && value.startsWith("@") ? t(language, value.slice(1)) : value]));
}

export const validationText = (language: string, message: ValidationMessage) =>
    t(language, `errors.${message.key}`, resolveParams(language, message.params));
