import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/App.Error.js";
import { verifyToken } from "../config/jwt.js";

export interface AuthRequest extends Request{
    user?: any
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new AppError("Token no proporcionado o no es valido", 401);
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = verifyToken(token!);
        req.user = decoded;
        next();
    }
    catch(err){
        throw new AppError("Token no valido o expirado", 401);
    }
}