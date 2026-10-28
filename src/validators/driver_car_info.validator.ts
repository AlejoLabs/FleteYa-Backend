import {z} from "zod";

export const createDriverCarInfoSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    brand: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la marca del auto"}),
    color: z.coerce.string().min(2, {message: "Minimo 2 caracteres para el color del auto"}),
    plate: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la placa del auto"}),
});

export type CreateDriverCarInfoInput = z.infer<typeof createDriverCarInfoSchema>;

// Un documento vencido no deja registrar el vehículo
const validUntil = (document: string) => z.coerce.date({message: `La fecha de vencimiento de ${document} no es válida`})
    .refine((val) => val.getTime() > Date.now(), {message: `${document} está vencido`});

// Categorías de licencia en Colombia (B particular, C servicio público). B1/C1 cubren camionetas y furgones livianos
// (tipo NHR); el camión sencillo pide B2/C2 o superior
const LICENSE_CATEGORIES = ["B1", "B2", "B3", "C1", "C2", "C3"] as const;
const HEAVY_CATEGORIES = ["B2", "B3", "C2", "C3"];

export const driverVehicleSchema = z.object({
    vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"], {message: "Elige el tipo de vehículo"}),
    brand: z.string().trim().min(2, {message: "La marca es obligatoria"}).max(50),
    color: z.string().trim().min(2, {message: "El color es obligatorio"}).max(50),
    // Placa de vehículo particular o de carga: 3 letras y 3 números, sin espacios ni guiones
    plate: z.string().transform((val) => val.toUpperCase().replace(/[\s-]/g, ""))
        .refine((val) => /^[A-Z]{3}\d{3}$/.test(val), {message: "La placa debe tener 3 letras y 3 números, por ejemplo ABC123"}),
    model_year: z.coerce.number().int().refine((val) => val >= 1980 && val <= new Date().getFullYear() + 1, {message: "El año del modelo no es válido"}),
    is_covered: z.boolean().default(false),
    license_number: z.string().trim().min(5, {message: "El número de la licencia es obligatorio"}).max(30),
    license_category: z.enum(LICENSE_CATEGORIES, {message: "La categoría de la licencia no es válida"}),
    license_expires_at: validUntil("La licencia"),
    soat_expires_at: validUntil("El SOAT"),
    // Los vehículos nuevos no la tienen los primeros años, por eso es opcional
    techno_expires_at: validUntil("La revisión técnico-mecánica").optional(),
    property_card_number: z.string().trim().min(5, {message: "El número de la tarjeta de propiedad es obligatorio"}).max(30),
}).refine((data) => data.vehicle_type !== "CAMION" || HEAVY_CATEGORIES.includes(data.license_category), {
    message: "Para camión necesitas licencia B2 o C2 en adelante",
    path: ["license_category"],
});

export type DriverVehicleInput = z.infer<typeof driverVehicleSchema>;
