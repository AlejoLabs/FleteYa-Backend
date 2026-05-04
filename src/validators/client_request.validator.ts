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

export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;