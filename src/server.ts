import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import usersRouter from "./routes/user.routes.js";
import authRouter from "./routes/auth.routes.js";
import clientRequestRouter from "./routes/client_request.routes.js";
import driverPositionRouter from "./routes/driver_position.routes.js";
import driverTripOfferRouter from "./routes/driver_trip_offer.routes.js";
import driverCarInfoRouter from "./routes/driver_car_info.routes.js";
import paymentSimulatorRouter, { paymentReturnRouter } from "./routes/payment_simulator.routes.js";
import adminRouter from "./routes/admin.routes.js";
import countriesRouter from "./routes/countries.routes.js";
import exchangeRatesRouter from "./routes/exchange_rates.routes.js";
import { startExchangeRateRefresh } from "./services/exchange/index.js";
import { errorHandler } from './middlewares/errorHandler.js';
import path from "path";
import { fileURLToPath } from 'url';
import {initializeSocket} from "./sockets/socketHandler.js";
import http from "http";
import { expireStaleRequests } from "./services/client_request_expiration.service.js";
import { remindExpiringDocuments, sendScheduledReminders } from "./services/reminders.service.js";

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
app.use("/countries", countriesRouter);
app.use("/exchange-rates", exchangeRatesRouter);
app.use("/payments/simulator", paymentSimulatorRouter);
app.use("/payments/return", paymentReturnRouter);
app.get("/", (req, res)=>{
    res.json({
        message: "Bienvenido a la API con Node.JS"
    });
});
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));

// Panel de administración: su API y la página (archivos estáticos de admin/). La página solo carga recursos propios
app.use("/admin/api", adminRouter);
app.use("/admin", express.static(path.join(__dirname, "../admin"), {
    setHeaders: (res) => {
        res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
    },
}));
app.use(errorHandler);

const server = http.createServer(app);
initializeSocket(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";

server.listen(Number (PORT), HOST, ()=>{
    console.log(`Servidor corriendo EN http://${HOST}:${PORT}`);
});

// Tipo de cambio de referencia: consulta las dos fuentes al arrancar y cada 30 minutos (Fase 9c)
startExchangeRateRefresh();

// Vence las búsquedas sin conductor. Un fallo (por ejemplo, la BD caída un momento) se registra y se reintenta en la siguiente vuelta
const EXPIRE_EVERY_MS = 30 * 1000;
setInterval(() => {
    expireStaleRequests().catch((err) => console.error("[expiracion] error", err));
    sendScheduledReminders().catch((err) => console.error("[recordatorios] error en fletes programados", err));
}, EXPIRE_EVERY_MS);

// Documentos por vencer: una revisión al arrancar y luego cada hora (cada conductor recibe como mucho un aviso por semana)
const DOCUMENTS_CHECK_EVERY_MS = 60 * 60 * 1000;
const checkDocuments = () => remindExpiringDocuments().catch((err) => console.error("[recordatorios] error en documentos", err));
setTimeout(checkDocuments, 60 * 1000);
setInterval(checkDocuments, DOCUMENTS_CHECK_EVERY_MS);