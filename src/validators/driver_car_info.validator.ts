import {z} from "zod";

export const createDriverCarInfoSchema = z.object({
    // El conductor sale del token; este campo se ignora y se conserva solo por compatibilidad con la app
    id_driver: z.coerce.number().optional(),
    brand: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la marca del auto"}),
    color: z.coerce.string().min(2, {message: "Minimo 2 caracteres para el color del auto"}),
    plate: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la placa del auto"}),
});

export type CreateDriverCarInfoInput = z.infer<typeof createDriverCarInfoSchema>;
