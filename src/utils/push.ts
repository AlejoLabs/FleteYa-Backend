import fs from "fs";
import path from "path";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import prisma from "../database/prismaClient.js";

// Notificaciones push con Firebase Cloud Messaging. Complementan a los sockets: llegan aunque la app esté cerrada.
// La llave privada va en un archivo fuera de git (FIREBASE_SERVICE_ACCOUNT_PATH); sin ella, en desarrollo solo se registran en consola

export type PushType =
    | "NEW_OFFER" | "DRIVER_ASSIGNED" | "DRIVER_ARRIVED" | "CARGO_PICKED_UP" | "DELIVERED"
    | "TRIP_CANCELED" | "SCHEDULED_REMINDER" | "DOCUMENTS_EXPIRING" | "CHAT_MESSAGE" | "TRIP_PAID";

interface PushMessage {
    title: string;
    body: string;
    type: PushType;
    id_client_request?: number;
}

let app: App | undefined;

let warnedMissingKey = false;

// Sin llave no se guarda el "no": si alguien la pone con el servidor corriendo, la siguiente notificación ya sale
const getApp = (): App | null => {
    if (app) return app;
    const keyPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? "firebase-service-account.json");
    if (!fs.existsSync(keyPath)) {
        if (!warnedMissingKey) {
            console.warn(`[push] sin llave de Firebase en ${keyPath}: las notificaciones solo se muestran en consola`);
            warnedMissingKey = true;
        }
        return null;
    }
    app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) }, "fleteya");
    return app;
}

// Nunca lanza: una notificación que falla no puede tumbar la acción que la originó (asignar, entregar...)
export const sendPush = async (userId: number, message: PushMessage) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { notification_token: true } });
        const firebase = getApp();
        if (!firebase) {
            console.log(`[push] (sin Firebase) usuario=${userId} ${message.type}: ${message.title}`);
            return;
        }
        if (!user?.notification_token) return;

        // data va como texto: es lo que la app lee al tocar la notificación para abrir la pantalla correcta
        const data: Record<string, string> = { type: message.type };
        if (message.id_client_request) data.id_client_request = String(message.id_client_request);

        await getMessaging(firebase).send({
            token: user.notification_token,
            notification: { title: message.title, body: message.body },
            data,
            android: { priority: "high", notification: { channelId: "trips" } },
        });
    } catch (err: any) {
        // El teléfono desinstaló la app o el token venció: se borra para no seguir intentando
        if (err?.code === "messaging/registration-token-not-registered" || err?.code === "messaging/invalid-registration-token") {
            await prisma.user.update({ where: { id: userId }, data: { notification_token: null } }).catch(() => {});
        }
        console.error(`[push] fallo usuario=${userId} ${message.type}: ${err?.code ?? err?.message ?? err}`);
    }
}

export const formatPesos = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;
