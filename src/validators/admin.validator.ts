import {z} from "zod";
import { emailSchema } from "./auth.validator.js";

// Lo que el panel de administración puede mandar. Los montos tienen techos para que un error de tecleo
// (un cero de más) no deje precios absurdos

export const adminLoginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, {message: "Escribe la contraseña"}),
});

const reason = (label: string) => z.string().trim()
    .min(5, {message: `Escribe ${label} (mínimo 5 caracteres)`})
    .max(240, {message: `${label[0]!.toUpperCase()}${label.slice(1)} es muy largo (máximo 240 caracteres)`});

export const suspendUserSchema = z.object({ reason: reason("el motivo") });
export const rejectDriverSchema = z.object({ note: reason("qué debe corregir") });
export const cancelTripSchema = z.object({ reason: reason("el motivo") });
export const incidentStatusSchema = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"], {message: "Estado no válido"}) });

// Montos en la moneda del país que se edita. Los techos son amplios para cualquier moneda (pensados en pesos)
const amount = (label: string, max: number) => z.coerce.number({message: `${label}: escribe un número`})
    .min(0, {message: `${label} no puede ser negativo`})
    .max(max, {message: `${label}: el máximo es ${max.toLocaleString("es-CO")}`});

export const updateRatesSchema = z.object({
    // País cuyas tarifas se cambian; sin él, Colombia (la pantalla de antes de la Fase 9b)
    country_code: z.string().regex(/^[A-Z]{2}$/, {message: "País no válido"}).optional(),
    km_value: amount("Valor por km", 20000),
    min_value: amount("Valor por minuto", 5000),
    weight_rate: amount("Valor por kg", 5000),
    size_rate: amount("Valor por m³", 100000),
    // Fracción: 0.1 = 10 %
    commission_rate: z.coerce.number().min(0, {message: "La comisión no puede ser negativa"}).max(0.5, {message: "La comisión no puede pasar del 50 %"}),
    vehicle_rates: z.array(z.object({
        vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"]),
        base_fare: amount("Tarifa base", 1000000),
        km_factor: z.coerce.number().min(0.1, {message: "El factor va de 0,1 a 10"}).max(10, {message: "El factor va de 0,1 a 10"}),
    })).max(4),
});

export type UpdateRatesInput = z.infer<typeof updateRatesSchema>;

// Filtros que llegan en la URL de los listados
export const pageOf = (value: unknown) => {
    const page = Number(value ?? 1);
    return Number.isInteger(page) && page > 0 && page < 10000 ? page : 1;
}

export const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
    options.includes(value as T) ? (value as T) : undefined;

export const searchText = (value: unknown) => (typeof value === "string" ? value.slice(0, 80) : undefined);
