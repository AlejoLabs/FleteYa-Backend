import e from "express";
import {z} from "zod";

export const createClientRequestSchema = z.object({
    id_client: z.coerce.number().refine((val) => val > 0, {message: "El id del cliente es obligatorio"}),
    pickup_lat: z.coerce.number().refine((val) => val > 0, {message: "La latitud de recogida es obligatoria"}),
    pickup_lng: z.coerce.number().refine((val) => val >= -180 && val <= 180, {message: "La longitud de recogida es obligatoria"}),
    destination_lat: z.coerce.number().refine((val) => val > 0, {message: "La latitud de destino es obligatoria"}),
    destination_lng: z.coerce.number().refine((val) => val >= -180 && val <= 180, {message: "La longitud de destino es obligatoria"}),
    fare_offered: z.coerce.number().refine((val) => val > 0, {message: "La tarifa del viaje es obligatoria"}),
    pickup_description: z.string().min(2, {message: "La descripción de recogida es obligatoria"}),
    destination_description: z.string().min(2, {message: "La descripción de destino es obligatoria"}),
});

export const assignDriverSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de cliente es obligatorio"}),
    fare_assigned: z.coerce.number().refine((val) => val > 0, {message: "La tarifa asignada es obligatoria"}),
    id_driver_assigned: z.coerce.number().refine((val) => val > 0, {message: "El id del conductor asignado es obligatorio"}),
    
});

export const updateClientRequestSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de cliente es obligatorio"}),
    status: z.string().min(2, {message: "El estado del viaje es obligatorio"}), 
});

export const updateClientRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud es obligatorio"}),
    client_rating: z.coerce.number().refine((val) => val > 0, {message: "La calificacion del cliente es obligatoria"}),
});

export const updateDriverRatingSchema = z.object({
    id: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud es obligatorio"}),
    driver_rating: z.coerce.number().refine((val) => val > 0, {message: "La calificacion del conductor es obligatoria"}),
});


export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type UpdateClientRequestInput = z.infer<typeof updateClientRequestSchema>;
export type UpdateClientRatingInput = z.infer<typeof updateClientRatingSchema>;
export type UpdateDriverRatingInput = z.infer<typeof updateDriverRatingSchema>;