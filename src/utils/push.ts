import fs from "fs";
import path from "path";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import prisma from "../database/prismaClient.js";
import { LOCALE_TAGS, normalizeLanguage, t, type Language, type Params } from "../i18n/index.js";
import { formatMoney } from "./money.js";

// Notificaciones push con Firebase Cloud Messaging. Complementan a los sockets: llegan aunque la app esté cerrada.
// La llave privada va en un archivo fuera de git (FIREBASE_SERVICE_ACCOUNT_PATH); sin ella, en desarrollo solo se registran en consola

export type PushType =
    | "NEW_OFFER" | "DRIVER_ASSIGNED" | "DRIVER_ARRIVED" | "CARGO_PICKED_UP" | "DELIVERED"
    | "TRIP_CANCELED" | "SCHEDULED_REMINDER" | "DOCUMENTS_EXPIRING" | "CHAT_MESSAGE" | "TRIP_PAID" | "NEW_REQUEST"
    | "DRIVER_REVIEWED";

// El texto no viaja escrito: va la clave (push.<key>.title y push.<key>.body) y sus datos, y se escribe
// en el idioma de quien lo recibe (users.language) justo antes de enviarlo
interface PushMessage {
    key: string;
    params?: Params;
    type: PushType;
    id_client_request?: number;
}

// Para los avisos cuyos datos también dependen del idioma (por ejemplo una lista de documentos)
export type PushContent = PushMessage | ((language: Language) => PushMessage);

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

// Título y texto de un aviso en el idioma dado (lo usa sendPush con el idioma guardado de cada usuario)
export const pushText = (language: string | null | undefined, message: { key: string; params?: Params }) => ({
    title: t(language, `push.${message.key}.title`, message.params),
    body: t(language, `push.${message.key}.body`, message.params),
});

// Nunca lanza: una notificación que falla no puede tumbar la acción que la originó (asignar, entregar...)
export const sendPush = async (userId: number, content: PushContent) => {
    let message: PushMessage = typeof content === "function" ? content("es") : content;
    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { notification_token: true, language: true } });
        const language = normalizeLanguage(user?.language);
        if (typeof content === "function") message = content(language);
        const { title, body } = pushText(language, message);
        const firebase = getApp();
        if (!firebase) {
            console.log(`[push] (sin Firebase) usuario=${userId} ${message.type}: ${title}`);
            return;
        }
        if (!user?.notification_token) return;

        // data va como texto: es lo que la app lee al tocar la notificación para abrir la pantalla correcta
        const data: Record<string, string> = { type: message.type };
        if (message.id_client_request) data.id_client_request = String(message.id_client_request);

        await getMessaging(firebase).send({
            token: user.notification_token,
            notification: { title, body },
            data,
            // Ícono propio (silueta del camión, ya incluida en la app) y color de la marca en la barra de notificaciones
            android: { priority: "high", notification: { channelId: "trips", icon: "notification_icon", color: "#1B2430" } },
        });
    } catch (err: any) {
        // El teléfono desinstaló la app o el token venció: se borra para no seguir intentando
        if (err?.code === "messaging/registration-token-not-registered" || err?.code === "messaging/invalid-registration-token") {
            await prisma.user.update({ where: { id: userId }, data: { notification_token: null } }).catch(() => {});
        }
        console.error(`[push] fallo usuario=${userId} ${message.type}: ${err?.code ?? err?.message ?? err}`);
    }
}

// Un monto de un aviso, en la moneda del viaje y con el formato del idioma de quien lo recibe ("$ 25.000", "25 €")
export const pushAmount = (value: number, currency: string, language: Language) =>
    formatMoney(value, currency, LOCALE_TAGS[language]);
