import {Server, Socket} from "socket.io";
import{Server as HttpServer} from "http";
import { AppError } from "../utils/App.Error.js";

let io: Server;

export const initializeSocket = (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket: Socket) => {
        console.log(`Cliente conectado: ${socket.id}`);

        socket.on("message", (data) => {
            console.log(`Mensaje recibido: ${data}`);
            io.emit("new_message", "Saludo desde el servidor");
        });

        socket.on("disconnect", () => {
            console.log(`Cliente desconectado`);
        });
    });
}

export const getIo = (): Server => {
    if (!io) {
        throw new AppError("Socket.io no ha sido inicializado", 500);
    }
    return io;
}