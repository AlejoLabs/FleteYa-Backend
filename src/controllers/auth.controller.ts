import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import { getUserId } from "../utils/authorization.js";

// Todos los manejadores de /auth hacen lo mismo: llaman al servicio con el cuerpo ya validado y responden 200
const handle = (action: (body: any) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            return res.status(200).json(await action(req.body));
        } catch (err) {
            next(err);
        }
    };

export const register = handle((body) => authService.register(body));
export const registerDriver = handle((body) => authService.registerDriver(body));
export const login = handle((body) => authService.loginUser(body));
export const forgotPassword = handle((body) => authService.forgotPassword(body.email));
export const resetPassword = handle((body) => authService.resetPassword(body));
export const loginWithGoogle = handle((body) => authService.loginWithGoogle(body.id_token));
export const linkGoogle = handle((body) => authService.linkGoogle(body));

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await authService.changePassword(getUserId(req), req.body));
    } catch (err) {
        next(err);
    }
};
