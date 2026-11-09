import type { Request, Response, NextFunction } from "express";
import {z} from "zod";
import { parseValidationMessage, validationText, type ValidationMessage } from "../i18n/validation.js";

export const validateBody = (schema: z.ZodTypeAny) =>{
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success){
            const parsed = result.error.issues.map((issue) => ({ raw: issue.message, coded: parseValidationMessage(issue.message) }));
            // message va en español (panel y pruebas); keys deja a la app traducir cada mensaje con su código
            const messages = parsed.map(({ raw, coded }) => (coded ? validationText("es", coded) : raw));
            const keys = parsed.map(({ coded }): ValidationMessage | null => coded);
            return res.status(400).json({
                message: messages.length === 1? messages[0] : messages,
                statusCode: 400,
                // Un null en la lista es un mensaje sin código: la app muestra el message de esa posición
                ...(keys.some(Boolean) ? { keys } : {}),
            })
        }

        req.body = result.data;
        next();
    }
}
