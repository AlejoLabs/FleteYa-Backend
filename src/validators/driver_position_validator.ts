import {z} from "zod";
import { latSchema, lngSchema } from "./client_request.validator.js";

export const createDriverPositionSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    // En Colombia la longitud es negativa: el rango cubre todo el mundo y solo descarta el 0,0 que manda un GPS sin señal
    lat: latSchema("lat"),
    lng: lngSchema("lng")
});

export type CreateDriverPositionInput = z.infer<typeof createDriverPositionSchema>;
