import bcrypt from "bcrypt";
import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { generateAdminToken } from "../../config/jwt.js";
import { hasRole, suspendedError } from "../../utils/authorization.js";
import { assertLoginAllowed, clearLoginFailures, registerLoginFailure } from "../../utils/loginThrottle.js";
import { logAdminAction } from "./admin_audit.service.js";

const WRONG = "Correo o contraseña incorrectos";

// Entrada al panel con el correo y la contraseña de una cuenta con rol ADMIN. Comparte el freno por intentos
// fallidos con la app, y un correo sin rol ADMIN responde igual que una contraseña equivocada
export const adminLogin = async (email: string, password: string) => {
    assertLoginAllowed(email);
    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, lastname: true, email: true, password: true, status: true, status_reason: true, anonymized_at: true },
    });
    const valid = user?.password && !user.anonymized_at && await bcrypt.compare(password, user.password);
    if (!user || !valid || !(await hasRole(user.id, "ADMIN"))) {
        registerLoginFailure(email);
        if (user) console.warn(`[authz] intento fallido de entrar al panel usuario=${user.id}`);
        throw new AppError(WRONG, 401);
    }
    if (user.status === "SUSPENDED") {
        throw suspendedError(user.status_reason);
    }
    clearLoginFailures(email);
    await logAdminAction(prisma, user.id, "LOGIN", "admin", user.id);
    return { token: generateAdminToken({ id: user.id }), admin: { id: user.id, name: `${user.name} ${user.lastname}`.trim(), email: user.email } };
}

export const getAdminProfile = async (adminId: number) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { id: true, name: true, lastname: true, email: true } });
    return { id: user.id, name: `${user.name} ${user.lastname}`.trim(), email: user.email };
}
