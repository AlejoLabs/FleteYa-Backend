import {z} from "zod";
import { createUserSchema } from "./user.validator.js";
import { driverVehicleSchema } from "./driver_car_info.validator.js";

// El correo se guarda y se busca sin espacios y en minúsculas
export const emailSchema = z.string().trim().toLowerCase().refine((val) => /\S+@\S+\.\S+/.test(val), {message: "EMAIL_FORMAT_INVALID"});
const passwordSchema = z.string().min(6, {message: "MIN_6_CHARS"});

export const loginSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
});

// Registro de conductor: los datos de la cuenta más el vehículo y sus documentos, en un solo paso
export const registerDriverSchema = createUserSchema.extend({
    vehicle: driverVehicleSchema,
});

export const forgotPasswordSchema = z.object({
    email: emailSchema,
});

export const resetPasswordSchema = z.object({
    email: emailSchema,
    code: z.string().trim().regex(/^\d{6}$/, {message: "CODE_6_DIGITS"}),
    password: passwordSchema,
});

export const googleLoginSchema = z.object({
    id_token: z.string().min(20, {message: "GOOGLE_TOKEN_MISSING"}),
    // Idioma del teléfono, por si la cuenta se crea en este momento
    language: z.string().max(10).optional(),
});

// Vincular Google a una cuenta que ya existía con ese correo: se pide su contraseña una vez
export const googleLinkSchema = googleLoginSchema.extend({
    password: passwordSchema,
});

// Con sesión abierta. Las cuentas de Google sin contraseña la crean sin escribir la actual
export const changePasswordSchema = z.object({
    current_password: z.string().optional(),
    new_password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type GoogleLinkInput = z.infer<typeof googleLinkSchema>;
