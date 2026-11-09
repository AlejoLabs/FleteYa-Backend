import {z} from "zod";
import { LANGUAGES } from "../i18n/languages.js";
import type { TypeOf } from "zod/v3";
export const createUserSchema = z.object({
    name: z.string().min(2, {message: "NAME_REQUIRED"}),
    lastname: z.string().min(2, {message: "LASTNAME_REQUIRED"}),
    // Sin espacios y en minúsculas, igual que en el login, para que "Ana@Gmail.com " y "ana@gmail.com" sean la misma cuenta
    email: z.string().trim().toLowerCase().refine((val) => /\S+@\S+\.\S+/.test(val), {message: "EMAIL_FORMAT_INVALID"}),
    phone: z.string().min(2, {message: "PHONE_REQUIRED"}),
    password: z.string().min(6, {message: "MIN_6_CHARS"}),
    // Idioma del teléfono al crear la cuenta; si no llega o no es uno de los nuestros, queda español
    language: z.string().max(10).optional(),
});

export const updateUserSchema = z.object({
    name: z.string().min(2, {message: "NAME_MIN_2"}).optional(),
    lastname: z.string().min(2, {message: "LASTNAME_MIN_2"}).optional(),
    phone: z.string().min(6, {message: "MIN_6_CHARS"}).optional(),

});

export type createUserInput = z.infer<typeof createUserSchema>;
export type updateUserInput = z.infer<typeof updateUserSchema>;
// null al cerrar sesión: ese teléfono deja de recibir notificaciones de la cuenta
// Cambiar el idioma de la app desde el perfil
export const languageSchema = z.object({
    language: z.enum(LANGUAGES, {message: "LANGUAGE_INVALID"}),
});

export const notificationTokenSchema = z.object({
    token: z.string().trim().min(20, {message: "NOTIFICATION_TOKEN_INVALID"}).max(255).nullable(),
});
