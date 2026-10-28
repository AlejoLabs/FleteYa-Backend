import type {Request, Response, NextFunction} from "express";
import multer from "multer";
import { AppError } from "../utils/App.Error.js";

export const errorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (err instanceof AppError){
        return res.status(err.statusCode).json({
            message: err.message,
            statusCode: err.statusCode,
            ...(err.code ? { code: err.code } : {}),
        });
    }

    if (err instanceof multer.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "La foto no puede pesar más de 5 MB"
            : "No se pudo subir el archivo";
        return res.status(400).json({ message, statusCode: 400 });
    }

    console.error(err);
    
    return res.status(err.statusCode || 500).json({
        message: "Internal server error",
        statusCode: 500,
    })
}