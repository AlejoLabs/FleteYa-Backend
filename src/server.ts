import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import usersRouter from "./routes/user.routes.js";
import authRouter from "./routes/auth.routes.js";
import { errorHandler } from './middlewares/errorHandler.js';
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json());


app.use("/users", usersRouter);
app.use("/auth", authRouter);
app.get("/", (req, res)=>{
    res.json({
        message: "Bienvenido a la API con Node.JS"
    });
});
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";

app.listen(Number (PORT), HOST, ()=>{
    console.log(`Servidor corriendo EN http://${HOST}:${PORT}`);
});