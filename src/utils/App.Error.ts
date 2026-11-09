import { hasKey, t, type Params } from "../i18n/index.js";

// Un error que le llega a la persona. El primer dato es el código del mensaje (por ejemplo "TRIP_NOT_FOUND"):
// la app lo traduce a su idioma con errors.TRIP_NOT_FOUND, y los datos variables viajan en params.
// message queda siempre en español: lo usan el panel de administración, las pruebas y los registros.
// Los errores que solo ve el panel (en español) pueden pasar el texto directo en vez del código.
export class AppError extends Error{
    public readonly statusCode: number;
    // Código opcional para que la app distinga casos con el mismo estado HTTP (por ejemplo, LINK_REQUIRED)
    public readonly code: string | undefined;
    // Código del mensaje traducible, si lo tiene
    public readonly key: string | undefined;
    public readonly params: Params | undefined;

    constructor(keyOrMessage: string, statusCode = 500, code?: string, params?: Params){
            const isKey = hasKey(`errors.${keyOrMessage}`);
            super(isKey ? t("es", `errors.${keyOrMessage}`, params) : keyOrMessage);
            this.statusCode = statusCode;
            this.code = code;
            this.key = isKey ? keyOrMessage : undefined;
            this.params = isKey ? params : undefined;
            Object.setPrototypeOf(this, new.target.prototype);
    }
}
