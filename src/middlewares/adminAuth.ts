import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/App.Error.js";
import { verifyAdminToken } from "../config/jwt.js";
import { assertActiveAccount, hasRole } from "../utils/authorization.js";

export const ADMIN_COOKIE = "fy_admin";

// Lee una cookie sin dependencias: el panel solo usa la suya
export const readCookie = (req: Request, name: string): string | null => {
    const header = req.headers.cookie ?? "";
    for (const part of header.split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return decodeURIComponent(value.join("="));
    }
    return null;
}

// Sesión del panel: cookie httpOnly (el JavaScript de la página no la puede leer) y SameSite=Strict.
// Además, todo lo que cambia datos pide el encabezado X-FleteYa-Admin, que un formulario de otro sitio no puede mandar
export const adminAuth = async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, ADMIN_COOKIE);
    if (!token) {
        throw new AppError("Inicia sesión en el panel", 401);
    }
    let adminId: number;
    try {
        adminId = Number(verifyAdminToken(token).id);
    } catch {
        throw new AppError("Tu sesión del panel venció. Entra de nuevo", 401);
    }
    await assertActiveAccount(adminId);
    // El rol se revisa en cada petición: si se lo quitan, pierde el acceso al instante
    if (!(await hasRole(adminId, "ADMIN"))) {
        console.warn(`[authz] panel denegado usuario=${adminId} ruta=${req.originalUrl}`);
        throw new AppError("No tienes permiso para entrar al panel", 403);
    }
    if (req.method !== "GET" && req.headers["x-fleteya-admin"] !== "1") {
        throw new AppError("Petición no permitida", 403);
    }
    (req as any).adminId = adminId;
    next();
}

export const getAdminId = (req: Request): number => (req as any).adminId;
