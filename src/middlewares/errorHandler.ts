import type {Request, Response, NextFunction} from "express";
import multer from "multer";
import { AppError } from "../utils/App.Error.js";
import { t } from "../i18n/index.js";

// Respuesta de error: message en español (panel, pruebas, registros), key + params para que la app lo traduzca
const errorBody = (statusCode: number, key: string, params?: Record<string, string | number>) => ({
    message: t("es", `errors.${key}`, params),
    statusCode,
    key,
    ...(params ? { params } : {}),
});

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
            ...(err.key ? { key: err.key } : {}),
            ...(err.key && err.params ? { params: err.params } : {}),
        });
    }

    if (err instanceof multer.MulterError) {
        const key = err.code === "LIMIT_FILE_SIZE"
            ? "FILE_TOO_LARGE"
            : err.code === "LIMIT_FILE_COUNT"
                ? "TOO_MANY_FILES"
                : "UPLOAD_FAILED";
        return res.status(400).json(errorBody(400, key));
    }

    // Errores al leer el cuerpo (JSON mal escrito, cuerpo demasiado grande): son del que llama, no del servidor
    if (typeof err?.type === "string" && err.type.startsWith("entity.") && err.status >= 400 && err.status < 500) {
        return res.status(err.status).json(errorBody(err.status, "MALFORMED_REQUEST"));
    }

    console.error(err);

    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
        message: "Internal server error",
        statusCode,
        key: "INTERNAL_ERROR",
    })
}
