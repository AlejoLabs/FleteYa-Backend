import {z} from "zod";
import { id } from "zod/locales";

export const createDriverTripOfferSchema = z.object({
    id_driver: z.coerce.number().refine((val) => val > 0, {message: "El id del conductor es obligatorio"}),
    id_client_request: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de viaje es obligatorio"}),
    fare_offered: z.coerce.number().refine((val) => val > 0, {message: "La tarifa es obligatoria"}),
    time: z.coerce.number().refine((val) => val > 0, {message: "El tiempo de llegada es obligatorio"}),
    distance: z.coerce.number().refine((val) => val > 0, {message: "La distancia de llegada es obligatoria"})
});

export type CreateDriverTripOfferInput = z.infer<typeof createDriverTripOfferSchema>;