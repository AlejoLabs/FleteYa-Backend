import {Server, Socket} from "socket.io";
import {Server as HttpServer} from "http";
import { AppError } from "../utils/App.Error.js";
import { verifyToken } from "../config/jwt.js";
import { hasRole } from "../utils/authorization.js";
import prisma from "../database/prismaClient.js";

let io: Server;

const ACTIVE_TRIP_STATUSES = ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"] as const;

// Cada usuario tiene su sala: los eventos privados (ofertas, asignación, estado del viaje) van solo a ella
const userRoom = (userId: number) => `user:${userId}`;
const DRIVERS_ROOM = "drivers";

const parsePayload = (data: any) => {
    if (typeof data !== "string") return data ?? {};
    try {
        return JSON.parse(data.replace(/,\s*([}\]])/g, "$1"));
    } catch {
        return {};
    }
}

const denySocket = (socket: Socket, event: string, detail: string) => {
    console.warn(`[authz] socket denegado usuario=${socket.data.userId} evento=${event} ${detail}`);
}

export const initializeSocket = (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // Sin token válido no hay conexión: la app manda el mismo "Bearer ..." que usa en la API
    io.use(async (socket, next) => {
        try {
            const raw = String(socket.handshake.auth?.token ?? "");
            const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
            const decoded: any = verifyToken(token);
            const userId = Number(decoded?.id);
            if (!Number.isInteger(userId) || userId <= 0) throw new Error("token sin id");
            socket.data.userId = userId;
            socket.data.isDriver = await hasRole(userId, "DRIVER");
            next();
        } catch {
            next(new Error("No autorizado"));
        }
    });

    io.on("connection", (socket: Socket) => {
        const userId: number = socket.data.userId;
        socket.join(userRoom(userId));
        if (socket.data.isDriver) socket.join(DRIVERS_ROOM);

        // Un error en un manejador (por ejemplo, la BD caída) se registra; sin esto una promesa rechazada tumbaría el servidor
        const on = (event: string, handler: (data: any) => void | Promise<void>) => {
            socket.on(event, async (data: any) => {
                try {
                    await handler(data);
                } catch (err) {
                    console.error(`[socket] error en ${event} usuario=${userId}`, err);
                }
            });
        };

        // Posición de un conductor disponible: la ven todos los clientes en el mapa. El id sale del token, no del mensaje
        on("change_driver_position", (data: any) => {
            if (!socket.data.isDriver) return denySocket(socket, "change_driver_position", "no es conductor");
            const payload = parsePayload(data);
            io.emit("new_driver_position", {
                "id_socket": socket.id,
                "id": userId,
                "lat": payload.lat,
                "lng": payload.lng
            });
        });

        // El conductor se pone "no disponible" sin cerrar el socket, que lo siguen usando sus otras pantallas
        on("driver_offline", () => {
            if (!socket.data.isDriver) return;
            io.emit("driver_disconnected", { id_socket: socket.id });
        });

        // Nueva solicitud: solo se avisa a los conductores, y solo si quien avisa es el dueño de la solicitud
        on("new_client_request", async (data: any) => {
            const idClientRequest = Number(parsePayload(data).id_client_request);
            const trip = await prisma.clientRequests.findUnique({ where: { id: idClientRequest }, select: { id_client: true } });
            if (!trip || trip.id_client !== userId) return denySocket(socket, "new_client_request", `viaje=${idClientRequest}`);
            io.to(DRIVERS_ROOM).emit("created_client_request", { "id_client_request": idClientRequest });
        });

        // Nueva oferta: se avisa solo al cliente dueño del viaje, y solo si el conductor de verdad ofertó
        on("new_driver_offer", async (data: any) => {
            const idClientRequest = Number(parsePayload(data).id_client_request);
            const offer = await prisma.driverTripOffer.findFirst({
                where: { id_client_request: idClientRequest, id_driver: userId },
                select: { client_request: { select: { id_client: true } } }
            });
            if (!offer) return denySocket(socket, "new_driver_offer", `viaje=${idClientRequest}`);
            io.to(userRoom(offer.client_request.id_client)).emit(`created_driver_offer/${idClientRequest}`, {
                "id_client_request": idClientRequest
            });
        });

        // Conductor asignado: el destino sale de la BD (no del mensaje), así nadie avisa a un conductor que no fue elegido
        on("new_driver_assigned", async (data: any) => {
            const idClientRequest = Number(parsePayload(data).id_client_request);
            const trip = await prisma.clientRequests.findUnique({
                where: { id: idClientRequest },
                select: { id_client: true, id_driver_assigned: true }
            });
            if (!trip || trip.id_client !== userId || !trip.id_driver_assigned) {
                return denySocket(socket, "new_driver_assigned", `viaje=${idClientRequest}`);
            }
            io.to(userRoom(trip.id_driver_assigned)).emit(`driver_assigned/${trip.id_driver_assigned}`, {
                "id_client_request": idClientRequest,
                "id_driver": trip.id_driver_assigned
            });
        });

        // Posición durante el viaje: solo el conductor asignado de un viaje activo con ese cliente puede enviarla
        on("trip_change_driver_position", async (data: any) => {
            const payload = parsePayload(data);
            const idClient = Number(payload.id_client);
            const trip = await prisma.clientRequests.findFirst({
                where: { id_client: idClient, id_driver_assigned: userId, status: { in: [...ACTIVE_TRIP_STATUSES] } },
                select: { id: true }
            });
            if (!trip) return denySocket(socket, "trip_change_driver_position", `cliente=${idClient}`);
            io.to(userRoom(idClient)).emit(`trip_new_driver_position/${idClient}`, {
                "id_socket": socket.id,
                "lat": payload.lat,
                "lng": payload.lng
            });
        });

        // Cambio de estado: se avisa al cliente con el estado guardado en la BD, que ya validó la API
        on("update_status_trip", async (data: any) => {
            const idClientRequest = Number(parsePayload(data).id_client_request);
            const trip = await prisma.clientRequests.findUnique({
                where: { id: idClientRequest },
                select: { id_client: true, id_driver_assigned: true, status: true }
            });
            if (!trip || trip.id_driver_assigned !== userId) {
                return denySocket(socket, "update_status_trip", `viaje=${idClientRequest}`);
            }
            io.to(userRoom(trip.id_client)).emit(`new_status_trip/${idClientRequest}`, {
                "id_socket": socket.id,
                "id_client_request": idClientRequest,
                "status": trip.status
            });
        });

        socket.on("disconnect", () => {
            if (socket.data.isDriver) {
                io.emit("driver_disconnected", { id_socket: socket.id });
            }
        });
    });
}

export const getIo = (): Server => {
    if (!io) {
        throw new AppError("Socket.io no ha sido inicializado", 500);
    }
    return io;
}

// Avisos que emite el propio servidor después de guardar un cambio (rechazos, cancelaciones, vencimientos).
// Si el socket no arrancó (por ejemplo, en un script) el aviso se omite: el cambio ya quedó en la BD
export const notifyUser = (userId: number, event: string, payload: object) => {
    io?.to(userRoom(userId)).emit(event, payload);
}

export const notifyDrivers = (event: string, payload: object) => {
    io?.to(DRIVERS_ROOM).emit(event, payload);
}
