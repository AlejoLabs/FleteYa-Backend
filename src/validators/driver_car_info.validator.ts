import {z} from "zod";

export const createDriverCarInfoSchema = z.object({
    id_driver: z.coerce.number().refine((val) => val > 0, {message: "El id del conductor es obligatorio"}),
    brand: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la marca del auto"}),
    color: z.coerce.string().min(2, {message: "Minimo 2 caracteres para el color del auto"}),
    plate: z.coerce.string().min(2, {message: "Minimo 2 caracteres para la placa del auto"}),
});

export type CreateDriverCarInfoInput = z.infer<typeof createDriverCarInfoSchema>;