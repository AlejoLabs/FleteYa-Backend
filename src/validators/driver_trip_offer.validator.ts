import {z} from "zod";
import { fareSchema } from "./client_request.validator.js";

export const createDriverTripOfferSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    id_client_request: z.coerce.number().refine((val) => val > 0, {message: "TRIP_REQUEST_ID_REQUIRED"}),
    fare_offered: fareSchema("offer"),
    time: z.coerce.number().refine((val) => val > 0, {message: "ARRIVAL_TIME_REQUIRED"}),
    distance: z.coerce.number().refine((val) => val > 0, {message: "ARRIVAL_DISTANCE_REQUIRED"})
});

export type CreateDriverTripOfferInput = z.infer<typeof createDriverTripOfferSchema>;
