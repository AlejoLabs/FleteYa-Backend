import {Server, Socket} from "socket.io";
import{ClientRequest, Server as HttpServer} from "http"    ;
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
        let clientRequest: any = null;

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

        socket.on("new_client_request", (data: any) => {
           const clientRequest = {
                "id_socket": socket.id,
                "id_client_request": typeof data === "string" ? JSON.parse(data || "{}").id_client_request : data?.id_client_request,
            }

            console.log("Nueva solicitud de cliente:", clientRequest);
            io.emit("created_client_request", clientRequest);
        });

        socket.on("new_driver_offer", (data: any) => {
            const clientRequest = {
                "id_socket": socket.id,
                "id_client_request": typeof data === "string" ? JSON.parse(data || "{}").id_client_request : data?.id_client_request,
            }

            console.log("Nueva oferta de conductor:", clientRequest);
            io.emit(`created_driver_offer/${clientRequest.id_client_request}`, clientRequest);
        });

        socket.on("new_driver_assigned", (data: any) => {
            const clientRequest = {
                "id_socket": socket.id,
                "id_client_request": typeof data === "string" ? JSON.parse(data || "{}").id_client_request : data?.id_client_request,
                "id_driver": typeof data === "string" ? JSON.parse(data || "{}").id_driver : data?.id_driver
            }

            console.log("Nuevo conductor asignado:", clientRequest);
            io.emit(`driver_assigned/${clientRequest.id_driver}`, clientRequest);
        });

        socket.on("trip_change_driver_position", (data: any) => {
            const payload = typeof data === "string" ? JSON.parse(data || "{}") : data;
            const driverPosition = {
                "id_socket": socket.id,
                "lat": payload?.lat,
                "lng": payload?.lng
            }

            console.log("Nuevo posicion del conductor asignado: ", driverPosition);
            io.emit(`trip_new_driver_position/${payload?.id_client}`, driverPosition);
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