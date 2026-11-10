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

// La categoría de la licencia depende del país: aquí solo su forma (1 a 3 letras o números). Las categorías válidas
// en Colombia y la que pide un camión se revisan en el servicio con el país del conductor (utils/licenseRules)
const licenseCategory = z.string().trim().toUpperCase()
    .refine((val) => /^[A-Z0-9]{1,3}$/.test(val), {message: "LICENSE_CATEGORY_INVALID"});

// Datos del vehículo que se piden al registrarse y se pueden cambiar después (por ejemplo, al cambiar de furgón)
const vehicleFields = {
    vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"], {message: "CHOOSE_VEHICLE_TYPE"}),
    brand: z.string().trim().min(2, {message: "BRAND_REQUIRED"}).max(50),
    color: z.string().trim().min(2, {message: "COLOR_REQUIRED"}).max(50),
    // Placa sin espacios ni guiones. El formato de cada país (en Colombia 3 letras y 3 números) se revisa en el servicio
    plate: z.string().transform((val) => val.toUpperCase().replace(/[\s-]/g, ""))
        .refine((val) => /^[A-Z0-9]{2,10}$/.test(val), {message: "PLATE_INVALID"}),
    model_year: z.coerce.number().int().refine((val) => val >= 1980 && val <= new Date().getFullYear() + 1, {message: "MODEL_YEAR_INVALID"}),
    is_covered: z.boolean().default(false),
};

export const driverVehicleSchema = z.object({
    ...vehicleFields,
    license_number: z.string().trim().min(5, {message: "LICENSE_NUMBER_REQUIRED"}).max(30),
    license_category: licenseCategory,
    license_expires_at: validUntil("license"),
    // SOAT en Colombia; en los demás países, el seguro obligatorio del vehículo
    soat_expires_at: validUntil("soat"),
    // Los vehículos nuevos no la tienen los primeros años, por eso es opcional
    techno_expires_at: validUntil("techno").optional(),
    property_card_number: z.string().trim().min(5, {message: "PROPERTY_CARD_REQUIRED"}).max(30),
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
    license_category: licenseCategory,
    license_expires_at: validUntil("license"),
    soat_expires_at: validUntil("soat"),
    techno_expires_at: validUntil("techno").nullable().optional(),
});

export type UpdateDocumentsInput = z.infer<typeof updateDocumentsSchema>;
