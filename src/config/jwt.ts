import "dotenv/config";
import  jwt from "jsonwebtoken";

// Sin un secreto propio cualquiera podría firmar tokens con el valor por defecto: el servidor no arranca sin él
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("Falta JWT_SECRET en el archivo .env");
}
const EXPIRES_IN = "2d";

export const generateToken =  (payload: object) =>{
    return jwt.sign(payload, JWT_SECRET, {expiresIn: EXPIRES_IN});
}

// Token de la app. Uno del panel (lleva audiencia) no se acepta aquí: cada sesión sirve solo donde se creó
export const verifyToken = (token: string) => {
    const payload = jwt.verify(token, JWT_SECRET);
    if (typeof payload === "object" && payload.aud) {
        throw new Error("Token del panel usado en la app");
    }
    return payload;
}

// Sesión del panel de administración: dura una jornada y lleva su propia audiencia,
// así un token de la app no sirve para entrar al panel
const ADMIN_AUDIENCE = "fleteya-admin";
export const ADMIN_SESSION_HOURS = 8;

export const generateAdminToken = (payload: { id: number }) =>
    jwt.sign(payload, JWT_SECRET, { expiresIn: `${ADMIN_SESSION_HOURS}h`, audience: ADMIN_AUDIENCE });

export const verifyAdminToken = (token: string) =>
    jwt.verify(token, JWT_SECRET, { audience: ADMIN_AUDIENCE }) as { id: number };
