import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { notifyUser } from "../sockets/socketHandler.js";
import { sendPush } from "../utils/push.js";
import { ACTIVE_STATUSES, assertTripParticipant } from "./client_request.shared.js";

// Chat del viaje: el cliente y el conductor asignado se escriben sin ver el celular del otro.
// Se puede escribir mientras el viaje está en curso; el historial lo siguen viendo los dos después

const HISTORY_LIMIT = 200;
// Freno contra mensajes en ráfaga (o un script): de sobra para una conversación normal
const MAX_MESSAGES_PER_MINUTE = 20;
const PUSH_PREVIEW_LENGTH = 120;

const formatMessage = (message: { id: number; id_client_request: number; id_sender: number; text: string; read_at: Date | null; created_at: Date }) => ({
    id: message.id,
    id_client_request: message.id_client_request,
    id_sender: message.id_sender,
    text: message.text,
    read_at: message.read_at,
    created_at: message.created_at,
});

const otherParticipant = (trip: { id_client: number; id_driver_assigned: number | null }, userId: number) =>
    trip.id_client === userId ? trip.id_driver_assigned : trip.id_client;

export const listMessages = async (userId: number, idTrip: number) => {
    await assertTripParticipant(idTrip, userId);
    // Los últimos 200, en orden de llegada
    const messages = await prisma.tripMessage.findMany({
        where: { id_client_request: idTrip },
        orderBy: { id: "desc" },
        take: HISTORY_LIMIT,
    });
    return messages.reverse().map(formatMessage);
}

export const sendMessage = async (userId: number, idTrip: number, text: string) => {
    const trip = await assertTripParticipant(idTrip, userId);
    const receiver = otherParticipant(trip, userId);
    if (!receiver || !ACTIVE_STATUSES.includes(trip.status)) {
        throw new AppError("El chat está abierto solo mientras el viaje está en curso", 409);
    }

    const recent = await prisma.tripMessage.count({
        where: { id_client_request: idTrip, id_sender: userId, created_at: { gte: new Date(Date.now() - 60_000) } }
    });
    if (recent >= MAX_MESSAGES_PER_MINUTE) {
        throw new AppError("Estás enviando muchos mensajes seguidos. Espera un momento", 429);
    }

    const message = await prisma.tripMessage.create({
        data: { id_client_request: idTrip, id_sender: userId, text },
        include: { sender: { select: { name: true } } }
    });
    const payload = formatMessage(message);

    notifyUser(receiver, `trip_message/${idTrip}`, payload);
    const preview = text.length > PUSH_PREVIEW_LENGTH ? `${text.slice(0, PUSH_PREVIEW_LENGTH)}…` : text;
    void sendPush(receiver, { type: "CHAT_MESSAGE", id_client_request: idTrip, title: `Mensaje de ${message.sender.name}`, body: preview });

    return payload;
}

// Marca como leídos los mensajes que le llegaron a quien abre el chat
export const markMessagesRead = async (userId: number, idTrip: number) => {
    await assertTripParticipant(idTrip, userId);
    const result = await prisma.tripMessage.updateMany({
        where: { id_client_request: idTrip, id_sender: { not: userId }, read_at: null },
        data: { read_at: new Date() }
    });
    return { updated: result.count };
}
