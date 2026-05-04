import type {Request, Response, NextFunction} from "express";
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
        });
    }
    
    console.error(err);
    
    return res.status(err.statusCode || 500).json({
        message: "Internal server error",
        statusCode: 500,
    })
}