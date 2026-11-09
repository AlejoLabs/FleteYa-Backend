import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/App.Error.js";
import { verifyToken } from "../config/jwt.js";
import { assertActiveAccount, SESSION_EXPIRED } from "../utils/authorization.js";

export { SESSION_EXPIRED };

export interface AuthRequest extends Request{
    user?: any
}

// Token válido y cuenta activa: una cuenta suspendida por el admin deja de funcionar en su siguiente petición
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new AppError("TOKEN_MISSING", 401, SESSION_EXPIRED);
    }

    const token = authHeader.split(" ")[1];

    let decoded: any;
    try {
        decoded = verifyToken(token!);
    }
    catch(err){
        throw new AppError("TOKEN_INVALID", 401, SESSION_EXPIRED);
    }
    req.user = decoded;
    await assertActiveAccount(Number(decoded?.id));
    next();
}
