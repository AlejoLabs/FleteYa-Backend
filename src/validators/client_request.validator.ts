import {z} from "zod";

// Límites de precio de un flete en pesos colombianos: evitan ofertas de $12 o valores absurdos
export const MIN_FARE = 5000;
export const MAX_FARE = 10000000;

export const fareSchema = (field: string) => z.coerce.number()
    .refine((val) => val >= MIN_FARE, {message: `${field} debe ser de al menos $${MIN_FARE.toLocaleString("es-CO")}`})
    .refine((val) => val <= MAX_FARE, {message: `${field} no puede superar $${MAX_FARE.toLocaleString("es-CO")}`});

export const latSchema = (field: string) => z.coerce.number().refine((val) => val >= -90 && val <= 90 && val !== 0, {message: `${field} no es válida`});
export const lngSchema = (field: string) => z.coerce.number().refine((val) => val >= -180 && val <= 180 && val !== 0, {message: `${field} no es válida`});

const ratingSchema = (field: string) => z.coerce.number().refine((val) => val >= 1 && val <= 5, {message: `${field} debe estar entre 1 y 5`});

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


export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type UpdateClientRequestInput = z.infer<typeof updateClientRequestSchema>;
export type UpdateClientRatingInput = z.infer<typeof updateClientRatingSchema>;
export type UpdateDriverRatingInput = z.infer<typeof updateDriverRatingSchema>;
