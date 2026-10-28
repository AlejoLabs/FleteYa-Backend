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

export const verifyToken = (token: string) => {
    return jwt.verify(token, JWT_SECRET);
}
