import bcrypt from "bcryptjs";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import type { ChangePasswordInput, GoogleLinkInput, LoginInput, RegisterDriverInput, ResetPasswordInput } from "../validators/auth.validator.js";
import { generateToken } from "../config/jwt.js";
import type { createUserInput } from "../validators/user.validator.js";
import { sendMail } from "../utils/mailer.js";
import type { RoleId } from "../utils/authorization.js";

const GOOGLE_ACCOUNT_MESSAGE = "Esta cuenta se creó con Google. Entra con Google o crea una contraseña con \"¿Olvidaste tu contraseña?\"";

// Respuesta de login común a todos los caminos (correo, registro, Google): token y usuario con sus roles
const buildAuthResponse = async (userId: number) => {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } }
    });
    const { password, google_id, roles, ...userData } = user;
    const token = generateToken({ id: user.id, email: user.email });
    return {
        token: `Bearer ${token}`,
        user: {
            ...userData,
            image: userData.image
                ? (userData.image.startsWith("http") ? userData.image : `http://${process.env.HOST}:${process.env.PORT}${userData.image}`)
                : null,
            has_password: password !== null,
            has_google: google_id !== null,
            roles: roles.map((userRole) => ({
                id: userRole.role.id,
                name: userRole.role.name,
                route: userRole.role.route,
                image: userRole.role.image
            }))
        }
    };
}

// Si el correo ya existe se dice cómo entrar, en vez del error genérico de base de datos
const assertEmailAvailable = async (email: string) => {
    const existing = await prisma.user.findUnique({ where: { email }, select: { password: true, google_id: true } });
    if (!existing) return;
    if (existing.password === null && existing.google_id !== null) {
        throw new AppError("Este correo ya está registrado con Google. Entra con Google", 409);
    }
    throw new AppError("Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña", 409);
}

const createUserWithRole = async (tx: any, data: createUserInput, role: RoleId) => {
    const user = await tx.user.create({
        data: {
            name: data.name,
            lastname: data.lastname,
            email: data.email,
            phone: data.phone,
            password: await bcrypt.hash(data.password, 10),
        }
    });
    await tx.userHasRole.create({ data: { id_user: user.id, id_rol: role } });
    return user;
}

export const register = async (data: createUserInput) => {
    await assertEmailAvailable(data.email);
    const user = await prisma.$transaction((tx) => createUserWithRole(tx, data, "CLIENT"));
    return buildAuthResponse(user.id);
}

// "Quiero transportar": la cuenta, el rol de conductor y el vehículo con sus documentos se crean juntos.
// Para la demo queda aprobado de una vez (approval_status APPROVED por defecto)
export const registerDriver = async (data: RegisterDriverInput) => {
    await assertEmailAvailable(data.email);
    const plateTaken = await prisma.driverCarInfo.findFirst({ where: { plate: data.vehicle.plate }, select: { id_driver: true } });
    if (plateTaken) {
        throw new AppError("Esa placa ya está registrada con otro conductor", 409);
    }

    const user = await prisma.$transaction(async (tx) => {
        const user = await createUserWithRole(tx, data, "DRIVER");
        const v = data.vehicle;
        await tx.driverCarInfo.create({
            data: {
                id_driver: user.id,
                vehicle_type: v.vehicle_type,
                brand: v.brand,
                color: v.color,
                plate: v.plate,
                model_year: v.model_year,
                is_covered: v.is_covered,
                license_number: v.license_number,
                license_category: v.license_category,
                license_expires_at: v.license_expires_at,
                soat_expires_at: v.soat_expires_at,
                techno_expires_at: v.techno_expires_at ?? null,
                property_card_number: v.property_card_number,
            }
        });
        return user;
    });
    return buildAuthResponse(user.id);
}

export const loginUser = async (data: LoginInput) => {
    const user = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true, password: true } });

    // Mismo mensaje si el correo no existe o la contraseña falla: así no se puede averiguar qué correos están registrados
    if (!user) {
        throw new AppError("Correo o contraseña incorrectos", 401);
    }
    if (user.password === null) {
        throw new AppError(GOOGLE_ACCOUNT_MESSAGE, 401);
    }
    if (!(await bcrypt.compare(data.password, user.password))) {
        throw new AppError("Correo o contraseña incorrectos", 401);
    }
    return buildAuthResponse(user.id);
}

// ---------- Restablecer contraseña con un código por correo ----------

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;

const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

export const FORGOT_PASSWORD_MESSAGE = "Si el correo está registrado, te enviamos un código para restablecer la contraseña";

// Siempre responde lo mismo, exista o no el correo. Limita a un código por minuto y cinco por hora
export const forgotPassword = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    if (!user) return { message: FORGOT_PASSWORD_MESSAGE };

    const recent = await prisma.passwordResetCode.findMany({
        where: { id_user: user.id, created_at: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
        select: { created_at: true },
        orderBy: { created_at: "desc" }
    });
    const tooSoon = recent[0] && Date.now() - recent[0].created_at.getTime() < RESEND_WAIT_MS;
    if (tooSoon || recent.length >= MAX_CODES_PER_HOUR) {
        console.warn(`[reset] límite de códigos usuario=${user.id}`);
        return { message: FORGOT_PASSWORD_MESSAGE };
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    await prisma.$transaction([
        // Un código nuevo anula los anteriores
        prisma.passwordResetCode.updateMany({ where: { id_user: user.id, used_at: null }, data: { used_at: new Date() } }),
        prisma.passwordResetCode.create({
            data: { id_user: user.id, code_hash: hashCode(code), expires_at: new Date(Date.now() + CODE_TTL_MS) }
        }),
    ]);

    try {
        await sendMail(
            user.email,
            "Tu código para restablecer la contraseña de FleteYa",
            `Hola ${user.name}, tu código es ${code}. Vence en 15 minutos. Si no lo pediste, ignora este correo.`,
            `<p>Hola ${user.name},</p><p>Tu código para restablecer la contraseña de FleteYa es:</p>` +
            `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>` +
            `<p>Vence en 15 minutos. Si no lo pediste, ignora este correo.</p>`
        );
    } catch (err) {
        console.error(`[reset] no se pudo enviar el correo usuario=${user.id}`, err);
        throw new AppError("No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos", 503);
    }
    return { message: FORGOT_PASSWORD_MESSAGE };
}

export const resetPassword = async (data: ResetPasswordInput) => {
    const invalid = new AppError("El código es incorrecto o ya venció. Pide uno nuevo", 400);
    const user = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (!user) throw invalid;

    const resetCode = await prisma.passwordResetCode.findFirst({
        where: { id_user: user.id, used_at: null, expires_at: { gt: new Date() } },
        orderBy: { created_at: "desc" }
    });
    if (!resetCode || resetCode.attempts >= MAX_CODE_ATTEMPTS) throw invalid;

    const expected = Buffer.from(resetCode.code_hash, "hex");
    const received = Buffer.from(hashCode(data.code), "hex");
    if (!crypto.timingSafeEqual(expected, received)) {
        await prisma.passwordResetCode.update({ where: { id: resetCode.id }, data: { attempts: { increment: 1 } } });
        throw invalid;
    }

    await prisma.$transaction([
        prisma.passwordResetCode.update({ where: { id: resetCode.id }, data: { used_at: new Date() } }),
        // Recibió el código en ese correo, así que el correo queda comprobado
        prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(data.password, 10), email_verified: true } }),
    ]);
    return { message: "Contraseña actualizada. Ya puedes iniciar sesión" };
}

// Cambiar la contraseña desde el perfil. Si ya tiene una, se pide la actual (alguien con el celular desbloqueado
// no debería poder cambiarla); si la cuenta es solo de Google, se crea sin ese paso
export const changePassword = async (userId: number, data: ChangePasswordInput) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { password: true } });
    if (user.password !== null) {
        if (!data.current_password || !(await bcrypt.compare(data.current_password, user.password))) {
            throw new AppError("La contraseña actual no es correcta", 400);
        }
        if (await bcrypt.compare(data.new_password, user.password)) {
            throw new AppError("La nueva contraseña debe ser distinta a la actual", 400);
        }
    }
    await prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(data.new_password, 10) } });
    return { message: user.password === null ? "Contraseña creada. Ya puedes entrar también con tu correo" : "Contraseña actualizada" };
}

// ---------- Entrar con Google ----------

const googleClient = new OAuth2Client();

// El token lo firma Google y debe ser para nuestra app (audience = ID de cliente web de Google Cloud)
const verifyGoogleToken = async (idToken: string) => {
    const audience = process.env.GOOGLE_WEB_CLIENT_ID;
    if (!audience) {
        throw new AppError("El inicio con Google no está configurado en el servidor", 503);
    }
    try {
        const ticket = await googleClient.verifyIdToken({ idToken, audience });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email || !payload.email_verified) throw new Error("token sin correo verificado");
        return {
            googleId: payload.sub,
            email: payload.email.toLowerCase(),
            name: payload.given_name ?? payload.name ?? "Usuario",
            lastname: payload.family_name ?? "",
            picture: payload.picture ?? null,
        };
    } catch (err) {
        console.warn("[google] token rechazado", (err as Error).message);
        throw new AppError("No pudimos validar tu cuenta de Google", 401);
    }
}

export const GOOGLE_LINK_REQUIRED = "LINK_REQUIRED";

export const loginWithGoogle = async (idToken: string) => {
    const google = await verifyGoogleToken(idToken);

    const linked = await prisma.user.findUnique({ where: { google_id: google.googleId }, select: { id: true } });
    if (linked) return buildAuthResponse(linked.id);

    const existing = await prisma.user.findUnique({ where: { email: google.email }, select: { id: true, google_id: true } });
    if (existing) {
        // La cuenta existía con contraseña: no se vincula sola, porque ese correo nunca se comprobó al registrarse
        // y cualquiera pudo haberla creado. La app pide la contraseña y llama a /auth/google/link
        throw new AppError("Ya tienes una cuenta con este correo. Escribe tu contraseña una vez para vincular Google", 409, GOOGLE_LINK_REQUIRED);
    }

    const user = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: {
                name: google.name,
                lastname: google.lastname,
                email: google.email,
                // Google no da el celular; la persona lo completa en su perfil
                phone: "",
                image: google.picture,
                password: null,
                google_id: google.googleId,
                email_verified: true,
            }
        });
        await tx.userHasRole.create({ data: { id_user: user.id, id_rol: "CLIENT" } });
        return user;
    });
    return buildAuthResponse(user.id);
}

export const linkGoogle = async (data: GoogleLinkInput) => {
    const google = await verifyGoogleToken(data.id_token);
    const user = await prisma.user.findUnique({ where: { email: google.email }, select: { id: true, password: true, google_id: true } });
    if (!user || user.password === null || !(await bcrypt.compare(data.password, user.password))) {
        throw new AppError("La contraseña no es correcta", 401);
    }
    if (user.google_id && user.google_id !== google.googleId) {
        throw new AppError("Esta cuenta ya está vinculada con otra cuenta de Google", 409);
    }
    await prisma.user.update({ where: { id: user.id }, data: { google_id: google.googleId, email_verified: true } });
    console.log(`[google] cuenta vinculada usuario=${user.id}`);
    return buildAuthResponse(user.id);
}
