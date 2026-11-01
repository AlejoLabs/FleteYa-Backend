import {z} from "zod";

// Límites de precio de un flete en pesos colombianos: evitan ofertas de $12 o valores absurdos
export const MIN_FARE = 5000;
export const MAX_FARE = 10000000;

export const fareSchema = (field: string) => z.coerce.number()
    .refine((val) => val >= MIN_FARE, {message: `${field} debe ser de al menos $${MIN_FARE.toLocaleString("es-CO")}`})
    .refine((val) => val <= MAX_FARE, {message: `${field} no puede superar $${MAX_FARE.toLocaleString("es-CO")}`});

export const latSchema = (field: string) => z.coerce.number().refine((val) => val >= -90 && val <= 90 && val !== 0, {message: `${field} no es válida`});
export const lngSchema = (field: string) => z.coerce.number().refine((val) => val >= -180 && val <= 180 && val !== 0, {message: `${field} no es válida`});

export const MIN_SCHEDULE_AHEAD_MS = 60 * 60 * 1000;
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

// Celular colombiano: 10 dígitos empezando por 3
const phoneSchema = (field: string) => z.string().trim().regex(/^3\d{9}$/, {message: `${field} debe tener 10 dígitos y empezar por 3`}).optional();
const floorSchema = (field: string) => z.coerce.number().int().refine((val) => val >= -5 && val <= 60, {message: `${field} no es válido`}).optional();

const ratingSchema =(field: string) => z.coerce.number().refine((val) => val >= 1 && val <= 5, {message: `${field} debe estar entre 1 y 5`});

export const createClientRequestSchema = z.object({
    // El cliente sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_client: z.coerce.number().optional(),
    pickup_lat: latSchema("La latitud de recogida"),
    pickup_lng: lngSchema("La longitud de recogida"),
    destination_lat: latSchema("La latitud de destino"),
    destination_lng: lngSchema("La longitud de destino"),
    fare_offered: fareSchema("La tarifa ofrecida"),
    pickup_description: z.string().min(2, {message: "La descripción de recogida es obligatoria"}),
    destination_description: z.string().min(2, {message: "La descripción de destino es obligatoria"}),
    cargo_description: z.string().max(255, {message: "La descripción de carga no puede superar 255 caracteres"}).optional(),
    weight_kg: z.coerce.number().refine((val) => val > 0, {message: "El peso debe ser mayor a 0"}).optional(),
    height_cm: z.coerce.number().refine((val) => val > 0, {message: "La altura debe ser mayor a 0"}).optional(),
    width_cm: z.coerce.number().refine((val) => val > 0, {message: "El ancho debe ser mayor a 0"}).optional(),
    length_cm: z.coerce.number().refine((val) => val > 0, {message: "El largo debe ser mayor a 0"}).optional(),

    cargo_category: z.enum(["MUDANZA", "MERCANCIA", "MATERIALES", "MAQUINARIA", "ELECTRODOMESTICOS", "OTRO"], {message: "La categoría de carga no es válida"}).default("OTRO"),
    packages: z.coerce.number().int().refine((val) => val >= 1 && val <= 500, {message: "El número de artículos debe estar entre 1 y 500"}).default(1),
    is_fragile: z.boolean().default(false),
    needs_cover: z.boolean().default(false),
    // El cliente puede pedir un vehículo más grande que el sugerido, nunca uno más pequeño
    vehicle_type: z.enum(["CARRY", "ESTACAS", "FURGON", "CAMION"], {message: "El tipo de vehículo no es válido"}).optional(),
    no_prohibited_items: z.boolean().refine((val) => val === true, {message: "Debes confirmar que la carga no es material peligroso ni animales"}),

    helpers: z.coerce.number().int().refine((val) => val >= 0 && val <= 6, {message: "Los ayudantes deben ser entre 0 y 6"}).default(0),
    pickup_floor: floorSchema("El piso de recogida"),
    pickup_has_elevator: z.boolean().optional(),
    destination_floor: floorSchema("El piso de destino"),
    destination_has_elevator: z.boolean().optional(),

    sender_name: z.string().trim().max(100).optional(),
    sender_phone: phoneSchema("El celular de quien entrega"),
    receiver_name: z.string().trim().max(100).optional(),
    receiver_phone: phoneSchema("El celular de quien recibe"),

    // Cómo paga al terminar el viaje; el conductor lo ve antes de ofertar
    payment_method: z.enum(["CASH", "WOMPI"], {message: "El método de pago no es válido"}).default("CASH"),
    declared_value: z.coerce.number().refine((val) => val >= 0 && val <= 1000000000, {message: "El valor de la carga no es válido"}).optional(),

    // Sin fecha el flete es "Ahora"
    scheduled_at: z.coerce.date({message: "La fecha programada no es válida"})
        .refine((val) => val.getTime() >= Date.now() + MIN_SCHEDULE_AHEAD_MS, {message: "Programa el flete con al menos 1 hora de anticipación"})
        .refine((val) => val.getTime() <= Date.now() + MAX_SCHEDULE_AHEAD_MS, {message: "Solo puedes programar fletes hasta 30 días adelante"})
        .optional(),
}).refine((data) => !data.sender_name || data.sender_phone, {message: "Falta el celular de quien entrega", path: ["sender_phone"]})
  .refine((data) => !data.receiver_name || data.receiver_phone, {message: "Falta el celular de quien recibe", path: ["receiver_phone"]});

export const raiseFareSchema = z.object({
    fare_offered: fareSchema("La nueva tarifa"),
});

export const paymentMethodSchema = z.object({
    payment_method: z.enum(["CASH", "WOMPI"], {message: "El método de pago no es válido"}),
});

export const cancelClientRequestSchema = z.object({
    reason: z.string().trim().min(3, {message: "Cuéntanos el motivo de la cancelación"}).max(255, {message: "El motivo no puede superar 255 caracteres"}),
});

export const assignDriverSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de cliente es obligatorio"}),
    // El valor asignado se toma de la oferta guardada; este campo se ignora
    fare_assigned: z.coerce.number().optional(),
    id_driver_assigned: z.coerce.number().refine((val) => val > 0, {message: "El id del conductor asignado es obligatorio"}),
});

export const updateClientRequestSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de cliente es obligatorio"}),
    status: z.enum(["ON_THE_WAY", "ARRIVED", "TRAVELING", "FINISHED"], {message: "El estado del viaje no es válido"}),
});

export const updateClientRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud es obligatorio"}),
    client_rating: ratingSchema("La calificación del cliente"),
});

export const updateDriverRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud es obligatorio"}),
    driver_rating: ratingSchema("La calificación del conductor"),
});

// Va como campo de texto del formulario multipart, junto al archivo
export const tripPhotoSchema = z.object({
    kind: z.enum(["CARGO", "PICKUP", "DELIVERY"], {message: "El tipo de foto debe ser CARGO, PICKUP o DELIVERY"}),
});

// Los mensajes del chat: texto sin espacios de sobra, de 1 a 500 caracteres
export const tripMessageSchema = z.object({
    text: z.string({message: "Escribe un mensaje"}).trim()
        .min(1, {message: "Escribe un mensaje"})
        .max(500, {message: "El mensaje puede tener hasta 500 caracteres"}),
});

// Va como campos de texto del formulario multipart, junto a las fotos
export const incidentSchema = z.object({
    kind: z.enum(["DAMAGE", "LOSS", "DELAY", "BEHAVIOR", "OTHER"], {message: "Elige qué pasó"}),
    description: z.string({message: "Cuenta qué pasó"}).trim()
        .min(10, {message: "Cuenta qué pasó con al menos 10 caracteres"})
        .max(1000, {message: "La descripción puede tener hasta 1000 caracteres"}),
});

export const deliverSchema = z.object({
    code: z.string().trim().regex(/^\d{4}$/, {message: "El código de entrega tiene 4 dígitos"}),
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
