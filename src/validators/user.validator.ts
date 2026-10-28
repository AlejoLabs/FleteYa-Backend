import {z} from "zod";
import type { TypeOf } from "zod/v3";
export const createUserSchema = z.object({
    name: z.string().min(2, {message: "El nombre es obligatorio"}),
    lastname: z.string().min(2, {message: "El apellido es obligatorio"}),
    // Sin espacios y en minúsculas, igual que en el login, para que "Ana@Gmail.com " y "ana@gmail.com" sean la misma cuenta
    email: z.string().trim().toLowerCase().refine((val) => /\S+@\S+\.\S+/.test(val), {message: "Formato del correo no valido"}),
    phone: z.string().min(2, {message: "El telefono es obligatorio"}),
    password: z.string().min(6, {message: "Minimo 6 caracteres"}),

});

export const updateUserSchema = z.object({
    name: z.string().min(2, {message: "El nombre debe tener al menos 2 caracteres"}).optional(),
    lastname: z.string().min(2, {message: "El apellido debe tener al menos 2 caracteres"}).optional(),
    phone: z.string().min(6, {message: "Minimo 6 caracteres"}).optional(),

});

export type createUserInput = z.infer<typeof createUserSchema>;
export type updateUserInput = z.infer<typeof updateUserSchema>;
// null al cerrar sesión: ese teléfono deja de recibir notificaciones de la cuenta
export const notificationTokenSchema = z.object({
    token: z.string().trim().min(20, {message: "El token de notificaciones no es válido"}).max(255).nullable(),
});
