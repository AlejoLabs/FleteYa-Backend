// Páginas web de otro dominio que pueden llamar a la API desde el navegador (CORS_ORIGINS, separadas por coma).
// La app no las necesita: una app nativa no pasa por CORS, y el panel y el simulador de pagos se sirven desde el mismo servidor.
// Sin la variable no se permite ningún otro origen (antes era "*": cualquier página podía llamar a la API)
export const allowedOrigins = (): string[] | false => {
    const origins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
    return origins.length > 0 ? origins : false;
}
