import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import usersRouter from "./routes/user.routes.js";
import authRouter from "./routes/auth.routes.js";
import clientRequestRouter from "./routes/client_request.routes.js";
import driverPositionRouter from "./routes/driver_position.routes.js";
import driverTripOfferRouter from "./routes/driver_trip_offer.routes.js";
import driverCarInfoRouter from "./routes/driver_car_info.routes.js";
import { errorHandler } from './middlewares/errorHandler.js';
import path from "path";
import { fileURLToPath } from 'url';
import {initializeSocket} from "./sockets/socketHandler.js";
import http from "http";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json());


app.use("/users", usersRouter);
app.use("/auth", authRouter);
app.use("/drivers-position", driverPositionRouter);
app.use("/client-requests", clientRequestRouter);
app.use("/driver-trip-offers", driverTripOfferRouter);
app.use("/driver-car-info", driverCarInfoRouter);
app.get("/", (req, res)=>{
    res.json({
        message: "Bienvenido a la API con Node.JS"
    });
});
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));
app.use(errorHandler);

const server = http.createServer(app);
initializeSocket(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";

server.listen(Number (PORT), HOST, ()=>{
    console.log(`Servidor corriendo EN http://${HOST}:${PORT}`);
});