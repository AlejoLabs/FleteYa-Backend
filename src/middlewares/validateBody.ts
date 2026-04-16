import type { Request, Response, NextFunction } from "express";
import {z} from "zod";

export const validateBody = (schema: z.ZodTypeAny) =>{
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success){
            const messages = result.error.issues.map(issue => issue.message);
            return res.status(400).json({
                message: messages.length === 1? messages[0] : messages,
                statusCode: 400
            })
        }

        req.body = result.data;
        next();
    }
}