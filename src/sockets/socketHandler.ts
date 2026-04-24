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

        socket.on("change_driver_position", (data) => {
            const position = {
                "id_socket": socket.id,
                "id": data.id,
                "lat": data.lat,
                "lng": data.lng
            }

            console.log("Nueva posicion:", position);
            io.emit("new_driver_position", position);
        });

        socket.on("disconnect", () => {
            console.log(`Cliente desconectado`);
            io.emit("driver_disconnected", { id_socket: socket.id });
        });
    });
}

export const getIo = (): Server => {
    if (!io) {
        throw new AppError("Socket.io no ha sido inicializado", 500);
    }
    return io;
}