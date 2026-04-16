import "dotenv/config";
import {PrismaMariaDb} from "@prisma/adapter-mariadb"
import {PrismaClient} from "../generated/prisma/client.js"

const adapter = new PrismaMariaDb({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "password",
    database: "apirest_nodejs2",
    connectionLimit: 10
});

const prisma = new PrismaClient({adapter});

export default prisma;
