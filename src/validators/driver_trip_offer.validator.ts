import {z} from "zod";
import { fareSchema } from "./client_request.validator.js";

export const createDriverTripOfferSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    id_client_request: z.coerce.number().refine((val) => val > 0, {message: "El id de la solicitud de viaje es obligatorio"}),
    fare_offered: fareSchema("La oferta"),
    time: z.coerce.number().refine((val) => val > 0, {message: "El tiempo de llegada es obligatorio"}),
    distance: z.coerce.number().refine((val) => val > 0, {message: "La distancia de llegada es obligatoria"})
});

export type CreateDriverTripOfferInput = z.infer<typeof createDriverTripOfferSchema>;
