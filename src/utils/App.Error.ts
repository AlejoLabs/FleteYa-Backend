import { object } from "zod";

export class AppError extends Error{
    public readonly statusCode: number;
    // Código opcional para que la app distinga casos con el mismo estado HTTP (por ejemplo, LINK_REQUIRED)
    public readonly code: string | undefined;

    constructor(message: string, statusCode = 500, code?: string){
            super(message);
            this.statusCode = statusCode;
            this.code = code;
            Object.setPrototypeOf(this, new.target.prototype);
    }
}