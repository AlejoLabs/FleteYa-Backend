import bcrypt from "bcryptjs";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import type { ChangePasswordInput, GoogleLinkInput, LoginInput, RegisterDriverInput, ResetPasswordInput } from "../validators/auth.validator.js";
import { generateToken } from "../config/jwt.js";
import type { createUserInput } from "../validators/user.validator.js";
import { sendMail } from "../utils/mailer.js";
import { normalizeLanguage, okMessage } from "../i18n/index.js";
import { resetCodeMail } from "../utils/mailTemplates.js";
import { suspendedError, type RoleId } from "../utils/authorization.js";
import { assertLoginAllowed, clearLoginFailures, registerLoginFailure } from "../utils/loginThrottle.js";

const GOOGLE_ACCOUNT_MESSAGE = "GOOGLE_ACCOUNT_NO_PASSWORD";

// Respuesta de login común a todos los caminos (correo, registro, Google): token y usuario con sus roles
const buildAuthResponse = async (userId: number) => {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } }
    });
    // Ningún camino de entrada (correo, Google, registro) abre sesión en una cuenta suspendida
    if (user.status === "SUSPENDED") {
        throw suspendedError(user.status_reason);
    }
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
        throw new AppError("EMAIL_REGISTERED_WITH_GOOGLE", 409);
    }
    throw new AppError("EMAIL_ALREADY_REGISTERED", 409);
}

const createUserWithRole = async (tx: any, data: createUserInput, role: RoleId) => {
    const user = await tx.user.create({
        data: {
            name: data.name,
            lastname: data.lastname,
            email: data.email,
            phone: data.phone,
            password: await bcrypt.hash(data.password, 10),
            // El idioma del teléfono al registrarse; después se cambia desde el perfil
            language: normalizeLanguage(data.language),
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
// Queda en revisión (approval_status PENDING) hasta que el admin verifique el vehículo y los documentos
export const registerDriver = async (data: RegisterDriverInput) => {
    await assertEmailAvailable(data.email);
    const plateTaken = await prisma.driverCarInfo.findFirst({ where: { plate: data.vehicle.plate }, select: { id_driver: true } });
    if (plateTaken) {
        throw new AppError("PLATE_ALREADY_REGISTERED", 409);
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
    assertLoginAllowed(data.email);
    const user = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true, password: true } });

    // Mismo mensaje si el correo no existe o la contraseña falla: así no se puede averiguar qué correos están registrados
    if (!user) {
        registerLoginFailure(data.email);
        throw new AppError("WRONG_CREDENTIALS", 401);
    }
    if (user.password === null) {
        throw new AppError(GOOGLE_ACCOUNT_MESSAGE, 401);
    }
    if (!(await bcrypt.compare(data.password, user.password))) {
        registerLoginFailure(data.email);
        throw new AppError("WRONG_CREDENTIALS", 401);
    }
    clearLoginFailures(data.email);
    return buildAuthResponse(user.id);
}

// ---------- Restablecer contraseña con un código por correo ----------

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;

const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

const forgotPasswordReply = () => okMessage("FORGOT_PASSWORD_SENT");

// Siempre responde lo mismo, exista o no el correo. Limita a un código por minuto y cinco por hora
export const forgotPassword = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, language: true } });
    if (!user) return forgotPasswordReply();

    const recent = await prisma.passwordResetCode.findMany({
        where: { id_user: user.id, created_at: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
        select: { created_at: true },
        orderBy: { created_at: "desc" }
    });
    const tooSoon = recent[0] && Date.now() - recent[0].created_at.getTime() < RESEND_WAIT_MS;
    if (tooSoon || recent.length >= MAX_CODES_PER_HOUR) {
        console.warn(`[reset] límite de códigos usuario=${user.id}`);
        return forgotPasswordReply();
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
        const mail = resetCodeMail(user.language, user.name, code, CODE_TTL_MS / 60000);
        await sendMail(user.email, mail.subject, mail.text, mail.html);
    } catch (err) {
        console.error(`[reset] no se pudo enviar el correo usuario=${user.id}`, err);
        throw new AppError("EMAIL_SEND_FAILED", 503);
    }
    return forgotPasswordReply();
}

export const resetPassword = async (data: ResetPasswordInput) => {
    const invalid = new AppError("CODE_INVALID", 400);
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
    return okMessage("PASSWORD_RESET_DONE");
}

// Cambiar la contraseña desde el perfil. Si ya tiene una, se pide la actual (alguien con el celular desbloqueado
// no debería poder cambiarla); si la cuenta es solo de Google, se crea sin ese paso
export const changePassword = async (userId: number, data: ChangePasswordInput) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { password: true } });
    if (user.password !== null) {
        if (!data.current_password || !(await bcrypt.compare(data.current_password, user.password))) {
            throw new AppError("CURRENT_PASSWORD_WRONG", 400);
        }
        if (await bcrypt.compare(data.new_password, user.password)) {
            throw new AppError("NEW_PASSWORD_SAME", 400);
        }
    }
    await prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(data.new_password, 10) } });
    return okMessage(user.password === null ? "PASSWORD_CREATED" : "PASSWORD_UPDATED");
}

// ---------- Entrar con Google ----------

const googleClient = new OAuth2Client();

// El token lo firma Google y debe ser para nuestra app (audience = ID de cliente web de Google Cloud)
const verifyGoogleToken = async (idToken: string) => {
    const audience = process.env.GOOGLE_WEB_CLIENT_ID;
    if (!audience) {
        throw new AppError("GOOGLE_NOT_CONFIGURED", 503);
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
        throw new AppError("GOOGLE_VALIDATION_FAILED", 401);
    }
}

export const GOOGLE_LINK_REQUIRED = "LINK_REQUIRED";

export const loginWithGoogle = async (idToken: string, language?: string) => {
    const google = await verifyGoogleToken(idToken);

    const linked = await prisma.user.findUnique({ where: { google_id: google.googleId }, select: { id: true } });
    if (linked) return buildAuthResponse(linked.id);

    const existing = await prisma.user.findUnique({ where: { email: google.email }, select: { id: true, google_id: true } });
    if (existing) {
        // La cuenta existía con contraseña: no se vincula sola, porque ese correo nunca se comprobó al registrarse
        // y cualquiera pudo haberla creado. La app pide la contraseña y llama a /auth/google/link
        throw new AppError("GOOGLE_LINK_PASSWORD_NEEDED", 409, GOOGLE_LINK_REQUIRED);
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
                language: normalizeLanguage(language),
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
        throw new AppError("PASSWORD_WRONG", 401);
    }
    if (user.google_id && user.google_id !== google.googleId) {
        throw new AppError("GOOGLE_ALREADY_LINKED", 409);
    }
    await prisma.user.update({ where: { id: user.id }, data: { google_id: google.googleId, email_verified: true } });
    console.log(`[google] cuenta vinculada usuario=${user.id}`);
    return buildAuthResponse(user.id);
}
