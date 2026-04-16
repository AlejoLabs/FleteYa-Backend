import {z} from "zod";

export const loginSchema = z.object({
    email: z.string().refine((val) => /\S+@\S+\.\S+/.test(val), {message: "Formato del correo no valido"}),
    password: z.string().min(6, {message: "Minimo 6 caracteres"}),
});

export type LoginInput = z.infer<typeof loginSchema>;