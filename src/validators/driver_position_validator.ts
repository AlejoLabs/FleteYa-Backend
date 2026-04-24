import {z} from "zod";

export const createDriverPositionSchema = z.object({
    id_driver: z.coerce.number().refine((val) => val > 0, {message: "El id del conductor es obligatorio"}),
    lat: z.coerce.number().refine((val) => val > 0, {message: "La latitud es obligatoria"}),
    lng: z.coerce.number().refine((val) => val > 0, {message: "La longitud es obligatoria"})
});

export type CreateDriverPositionInput = z.infer<typeof createDriverPositionSchema>;