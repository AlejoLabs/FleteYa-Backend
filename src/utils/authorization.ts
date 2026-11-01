import type { Request, Response, NextFunction } from "express";
import prisma from "../database/prismaClient.js";
import { AppError } from "./App.Error.js";
import { SESSION_EXPIRED } from "../middlewares/authMiddleware.js";

export type RoleId = "CLIENT" | "DRIVER" | "ADMIN";

// Cada acceso denegado queda registrado con quién lo intentó y sobre qué recurso
export const deny = (userId: number | undefined, action: string, resource: string): AppError => {
    console.warn(`[authz] denegado usuario=${userId ?? "anonimo"} accion=${action} recurso=${resource}`);
    return new AppError("No tienes permiso para realizar esta acción", 403);
}

// La identidad sale siempre del token verificado por authMiddleware, nunca del cuerpo de la petición
export const getUserId = (req: Request): number => {
    const id = Number((req as any).user?.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError("Token no valido o expirado", 401, SESSION_EXPIRED);
    }
    return id;
}

// Los roles se consultan en la BD en cada petición: si a alguien le quitan un rol, deja de tenerlo de inmediato
export const hasRole = async (userId: number, role: RoleId): Promise<boolean> => {
    const row = await prisma.userHasRole.findUnique({
        where: { id_user_id_rol: { id_user: userId, id_rol: role } }
    });
    return row !== null;
}

export const requireRole = (role: RoleId) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = getUserId(req);
        if (!(await hasRole(userId, role))) {
            throw deny(userId, `rol:${role}`, req.originalUrl);
        }
        next();
    } catch (err) {
        next(err);
    }
}

// Para rutas del tipo /recurso/:id_usuario: solo el propio usuario puede usarlas
export const requireSelfParam = (param: string) => (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = getUserId(req);
        if (Number(req.params[param]) !== userId) {
            throw deny(userId, "solo-propio", req.originalUrl);
        }
        next();
    } catch (err) {
        next(err);
    }
}
