import {z} from "zod";
import { vm } from "../i18n/validation.js";

// Aquí solo que sea un número positivo. Los límites (en Colombia de $5.000 a $10.000.000) y los decimales dependen
// de la moneda del flete: los revisa el servicio con checkFare (services/countries.service)
export const fareSchema = (field: string) => z.coerce.number()
    .refine((val) => Number.isFinite(val) && val > 0, {message: vm("FARE_INVALID", { field: `@fields.${field}` })});

export const latSchema = (field: string) => z.coerce.number().refine((val) => val >= -90 && val <= 90 && val !== 0, {message: vm("LAT_INVALID", { field: `@fields.${field}` })});
export const lngSchema = (field: string) => z.coerce.number().refine((val) => val >= -180 && val <= 180 && val !== 0, {message: vm("LNG_INVALID", { field: `@fields.${field}` })});

export const MIN_SCHEDULE_AHEAD_MS = 60 * 60 * 1000;
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

// Solo dígitos. El formato del país del flete (en Colombia, 10 dígitos empezando por 3) lo revisa el servicio
const phoneSchema = (field: string) => z.string().trim().regex(/^\d{6,15}$/, {message: vm("PHONE_DIGITS", { field: `@fields.${field}` })}).optional();
const floorSchema = (field: string) => z.coerce.number().int().refine((val) => val >= -5 && val <= 60, {message: vm("FLOOR_INVALID", { field: `@fields.${field}` })}).optional();

const ratingSchema =(field: string) => z.coerce.number().refine((val) => val >= 1 && val <= 5, {message: vm("RATING_RANGE", { field: `@fields.${field}` })});

export const createClientRequestSchema = z.object({
    // El cliente sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_client: z.coerce.number().optional(),
    pickup_lat: latSchema("pickup_lat"),
    pickup_lng: lngSchema("pickup_lng"),
    destination_lat: latSchema("destination_lat"),
    destination_lng: lngSchema("destination_lng"),
    fare_offered: fareSchema("fare_offered"),
    pickup_description: z.string().min(2, {message: "PICKUP_DESCRIPTION_REQUIRED"}),
    destination_description: z.string().min(2, {message: "DESTINATION_DESCRIPTION_REQUIRED"}),
    cargo_description: z.string().max(255, {message: "CARGO_DESCRIPTION_MAX"}).optional(),
    weight_kg: z.coerce.number().refine((val) => val > 0, {message: "WEIGHT_POSITIVE"}).optional(),
    height_cm: z.coerce.number().refine((val) => val > 0, {message: "HEIGHT_POSITIVE"}).optional(),
    width_cm: z.coerce.number().refine((val) => val > 0, {message: "WIDTH_POSITIVE"}).optional(),
    length_cm: z.coerce.number().refine((val) => val > 0, {message: "LENGTH_POSITIVE"}).optional(),

    cargo_category: z.enum(["MUDANZA", "MERCANCIA", "MATERIALES", "MAQUINARIA", "ELECTRODOMESTICOS", "OTRO"], {message: "CARGO_CATEGORY_INVALID"}).default("OTRO"),
    packages: z.coerce.number().int().refine((val) => val >= 1 && val <= 500, {message: "PACKAGES_RANGE"}).default(1),
    is_fragile: z.boolean().default(false),
    needs_cover: z.boolean().default(false),
    // El cliente puede pedir un vehículo más grande que el sugerido, nunca uno más pequeño
    vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"], {message: "VEHICLE_TYPE_INVALID"}).optional(),
    no_prohibited_items: z.boolean().refine((val) => val === true, {message: "CONFIRM_NO_PROHIBITED"}),

    helpers: z.coerce.number().int().refine((val) => val >= 0 && val <= 6, {message: "HELPERS_RANGE"}).default(0),
    pickup_floor: floorSchema("pickup_floor"),
    pickup_has_elevator: z.boolean().optional(),
    destination_floor: floorSchema("destination_floor"),
    destination_has_elevator: z.boolean().optional(),

    sender_name: z.string().trim().max(100).optional(),
    sender_phone: phoneSchema("sender_phone"),
    receiver_name: z.string().trim().max(100).optional(),
    receiver_phone: phoneSchema("receiver_phone"),

    // Cómo paga al terminar el viaje; el conductor lo ve antes de ofertar
    payment_method: z.enum(["CASH", "WOMPI"], {message: "PAYMENT_METHOD_INVALID"}).default("CASH"),
    declared_value: z.coerce.number().refine((val) => val >= 0 && val <= 1000000000, {message: "DECLARED_VALUE_INVALID"}).optional(),

    // Sin fecha el flete es "Ahora"
    scheduled_at: z.coerce.date({message: "SCHEDULE_DATE_INVALID"})
        .refine((val) => val.getTime() >= Date.now() + MIN_SCHEDULE_AHEAD_MS, {message: "SCHEDULE_TOO_SOON"})
        .refine((val) => val.getTime() <= Date.now() + MAX_SCHEDULE_AHEAD_MS, {message: "SCHEDULE_TOO_FAR"})
        .optional(),
}).refine((data) => !data.sender_name || data.sender_phone, {message: "SENDER_PHONE_MISSING", path: ["sender_phone"]})
  .refine((data) => !data.receiver_name || data.receiver_phone, {message: "RECEIVER_PHONE_MISSING", path: ["receiver_phone"]});

export const raiseFareSchema = z.object({
    fare_offered: fareSchema("new_fare"),
});

export const paymentMethodSchema = z.object({
    payment_method: z.enum(["CASH", "WOMPI"], {message: "PAYMENT_METHOD_INVALID"}),
});

export const cancelClientRequestSchema = z.object({
    reason: z.string().trim().min(3, {message: "CANCEL_REASON_REQUIRED"}).max(255, {message: "REASON_MAX_255"}),
});

export const assignDriverSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "CLIENT_REQUEST_ID_REQUIRED"}),
    // El valor asignado se toma de la oferta guardada; este campo se ignora
    fare_assigned: z.coerce.number().optional(),
    id_driver_assigned: z.coerce.number().refine((val) => val > 0, {message: "DRIVER_ASSIGNED_ID_REQUIRED"}),
});

export const updateClientRequestSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "CLIENT_REQUEST_ID_REQUIRED"}),
    status: z.enum(["ON_THE_WAY", "ARRIVED", "TRAVELING", "FINISHED"], {message: "TRIP_STATUS_INVALID"}),
});

export const updateClientRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "REQUEST_ID_REQUIRED"}),
    client_rating: ratingSchema("client_rating"),
});

export const updateDriverRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "REQUEST_ID_REQUIRED"}),
    driver_rating: ratingSchema("driver_rating"),
});

// Va como campo de texto del formulario multipart, junto al archivo
export const tripPhotoSchema = z.object({
    kind: z.enum(["CARGO", "PICKUP", "DELIVERY"], {message: "PHOTO_KIND_INVALID"}),
});

// Los mensajes del chat: texto sin espacios de sobra, de 1 a 500 caracteres
export const tripMessageSchema = z.object({
    text: z.string({message: "MESSAGE_REQUIRED"}).trim()
        .min(1, {message: "MESSAGE_REQUIRED"})
        .max(500, {message: "MESSAGE_MAX_500"}),
});

// Va como campos de texto del formulario multipart, junto a las fotos
export const incidentSchema = z.object({
    kind: z.enum(["DAMAGE", "LOSS", "DELAY", "BEHAVIOR", "OTHER"], {message: "INCIDENT_KIND_REQUIRED"}),
    description: z.string({message: "INCIDENT_DESCRIPTION_REQUIRED"}).trim()
        .min(10, {message: "INCIDENT_DESCRIPTION_MIN"})
        .max(1000, {message: "DESCRIPTION_MAX_1000"}),
});

export const deliverSchema = z.object({
    code: z.string().trim().regex(/^\d{4}$/, {message: "DELIVERY_CODE_4_DIGITS"}),
});


export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type UpdateClientRequestInput = z.infer<typeof updateClientRequestSchema>;
export type UpdateClientRatingInput = z.infer<typeof updateClientRatingSchema>;
export type UpdateDriverRatingInput = z.infer<typeof updateDriverRatingSchema>;
export type RaiseFareInput = z.infer<typeof raiseFareSchema>;
export type CancelClientRequestInput = z.infer<typeof cancelClientRequestSchema>;
export type DeliverInput = z.infer<typeof deliverSchema>;
export type IncidentInput = z.infer<typeof incidentSchema>;
