import {z} from "zod";
import { vm } from "../i18n/validation.js";
import { CAPACITY_LIMITS } from "../utils/vehicles.js";

export const createDriverCarInfoSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    brand: z.coerce.string().min(2, {message: "BRAND_MIN_2"}),
    color: z.coerce.string().min(2, {message: "COLOR_MIN_2"}),
    plate: z.coerce.string().min(2, {message: "PLATE_MIN_2"}),
});

export type CreateDriverCarInfoInput = z.infer<typeof createDriverCarInfoSchema>;

// Un documento vencido no deja registrar el vehículo
const validUntil = (document: string) => z.coerce.date({message: vm("DOC_DATE_INVALID", { document: `@fields.${document}` })})
    .refine((val) => val.getTime() > Date.now(), {message: vm("DOC_EXPIRED", { document: `@fields.${document}` })});

// Categorías de licencia en Colombia (B particular, C servicio público). B1/C1 cubren camionetas y furgones livianos
// (tipo NHR); el camión sencillo pide B2/C2 o superior
const LICENSE_CATEGORIES = ["B1", "B2", "B3", "C1", "C2", "C3"] as const;
const HEAVY_CATEGORIES = ["B2", "B3", "C2", "C3"];

// Datos del vehículo que se piden al registrarse y se pueden cambiar después (por ejemplo, al cambiar de furgón)
const vehicleFields = {
    vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"], {message: "CHOOSE_VEHICLE_TYPE"}),
    brand: z.string().trim().min(2, {message: "BRAND_REQUIRED"}).max(50),
    color: z.string().trim().min(2, {message: "COLOR_REQUIRED"}).max(50),
    // Placa de vehículo particular o de carga: 3 letras y 3 números, sin espacios ni guiones
    plate: z.string().transform((val) => val.toUpperCase().replace(/[\s-]/g, ""))
        .refine((val) => /^[A-Z]{3}\d{3}$/.test(val), {message: "PLATE_FORMAT"}),
    model_year: z.coerce.number().int().refine((val) => val >= 1980 && val <= new Date().getFullYear() + 1, {message: "MODEL_YEAR_INVALID"}),
    is_covered: z.boolean().default(false),
};

export const driverVehicleSchema = z.object({
    ...vehicleFields,
    license_number: z.string().trim().min(5, {message: "LICENSE_NUMBER_REQUIRED"}).max(30),
    license_category: z.enum(LICENSE_CATEGORIES, {message: "LICENSE_CATEGORY_INVALID"}),
    license_expires_at: validUntil("license"),
    soat_expires_at: validUntil("soat"),
    // Los vehículos nuevos no la tienen los primeros años, por eso es opcional
    techno_expires_at: validUntil("techno").optional(),
    property_card_number: z.string().trim().min(5, {message: "PROPERTY_CARD_REQUIRED"}).max(30),
}).refine((data) => data.vehicle_type !== "CAMION" || HEAVY_CATEGORIES.includes(data.license_category), {
    message: "TRUCK_NEEDS_LICENSE",
    path: ["license_category"],
});

export type DriverVehicleInput = z.infer<typeof driverVehicleSchema>;

// Cambiar el vehículo: tipo, datos y, si es más grande que el típico, su capacidad real (null = la típica)
export const updateVehicleSchema = z.object({
    ...vehicleFields,
    capacity_kg: z.coerce.number().int().refine((val) => val > 0, {message: "CAPACITY_KG_POSITIVE"}).nullable().optional(),
    capacity_m3: z.coerce.number().refine((val) => val > 0, {message: "CAPACITY_M3_POSITIVE"}).nullable().optional(),
}).refine((data) => !data.capacity_kg || data.capacity_kg <= CAPACITY_LIMITS[data.vehicle_type].max_weight_kg, {
    message: "CAPACITY_KG_TOO_HIGH",
    path: ["capacity_kg"],
}).refine((data) => !data.capacity_m3 || data.capacity_m3 <= CAPACITY_LIMITS[data.vehicle_type].max_volume_m3, {
    message: "CAPACITY_M3_TOO_HIGH",
    path: ["capacity_m3"],
});

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

// Renovar los documentos: nuevas fechas de vencimiento y, si cambió, la categoría de la licencia
export const updateDocumentsSchema = z.object({
    license_category: z.enum(LICENSE_CATEGORIES, {message: "LICENSE_CATEGORY_INVALID"}),
    license_expires_at: validUntil("license"),
    soat_expires_at: validUntil("soat"),
    techno_expires_at: validUntil("techno").nullable().optional(),
});

export type UpdateDocumentsInput = z.infer<typeof updateDocumentsSchema>;

export const isHeavyLicense = (category: string | null | undefined) => HEAVY_CATEGORIES.includes(category ?? "");
