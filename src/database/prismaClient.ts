import "dotenv/config";
import {PrismaMariaDb} from "@prisma/adapter-mariadb"
import {PrismaClient} from "../generated/prisma/client.js"

// Las credenciales salen de DATABASE_URL (.env), no del código: así no quedan en el repositorio
if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL en el archivo .env");
}
const databaseUrl = new URL(process.env.DATABASE_URL);

const adapter = new PrismaMariaDb({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 3306),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\//, ""),
    connectionLimit: 10,
    allowPublicKeyRetrieval: true
});

const prisma = new PrismaClient({adapter});

export default prisma;
