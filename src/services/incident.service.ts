import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import { deletePhotoFile, photoPath, savePhoto } from "../utils/photoStorage.js";
import type { IncidentKind } from "../generated/prisma/enums.js";
import { ACTIVE_STATUSES, assertTripParticipant } from "./client_request.shared.js";

// Reportes de daño, pérdida u otro problema de un viaje. Los ve quien los hizo; el administrador los revisa en la Fase 8

export const MAX_INCIDENT_PHOTOS = 4;
const MAX_REPORTS_PER_TRIP = 3;
// Después de terminar o cancelar, hay una semana para reportar (un daño se puede notar al desempacar)
const REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const folderOf = (idTrip: number) => `trips/${idTrip}/incidents`;

type IncidentWithPhotos = {
    id: number; id_client_request: number; kind: IncidentKind; description: string; status: string; created_at: Date;
    photos: { id: number }[];
};

const formatIncident = (incident: IncidentWithPhotos) => ({
    id: incident.id,
    id_client_request: incident.id_client_request,
    kind: incident.kind,
    description: incident.description,
    status: incident.status,
    created_at: incident.created_at,
    photos: incident.photos.map((photo) => ({
        id: photo.id,
        url: `/client-requests/${incident.id_client_request}/incidents/${incident.id}/photos/${photo.id}`,
    })),
});

// Se reporta un viaje que tuvo conductor: en curso, o terminado o cancelado hace menos de una semana
const assertCanReport = async (idTrip: number, trip: Awaited<ReturnType<typeof assertTripParticipant>>) => {
    if (!trip.id_driver_assigned) {
        throw new AppError("Solo puedes reportar un viaje que ya tiene conductor", 409);
    }
    if (ACTIVE_STATUSES.includes(trip.status)) return;
    if (trip.status === "FINISHED" || trip.status === "CANCELED") {
        const { update_at } = await prisma.clientRequests.findUniqueOrThrow({ where: { id: idTrip }, select: { update_at: true } });
        if (Date.now() - update_at.getTime() <= REPORT_WINDOW_MS) return;
        throw new AppError("Pasó más de una semana desde el viaje: escríbenos a soporte para reportarlo", 409);
    }
    throw new AppError("Este viaje no se puede reportar", 409);
}

export const createIncident = async (
    userId: number, idTrip: number, data: { kind: IncidentKind; description: string }, files: Express.Multer.File[] = []
) => {
    const trip = await assertTripParticipant(idTrip, userId);
    await assertCanReport(idTrip, trip);

    const previous = await prisma.incidentReport.count({ where: { id_client_request: idTrip, id_reporter: userId } });
    if (previous >= MAX_REPORTS_PER_TRIP) {
        throw new AppError(`Ya enviaste ${MAX_REPORTS_PER_TRIP} reportes de este viaje. Te contactaremos pronto`, 409);
    }

    // Si una foto no es válida o la BD falla, no quedan archivos sueltos en disco
    const saved: string[] = [];
    try {
        for (const file of files) {
            saved.push(await savePhoto(folderOf(idTrip), file));
        }
        const incident = await prisma.incidentReport.create({
            data: {
                id_client_request: idTrip,
                id_reporter: userId,
                kind: data.kind,
                description: data.description,
                photos: { create: saved.map((file_name) => ({ file_name })) },
            },
            include: { photos: { select: { id: true } } }
        });
        console.info(`[incidente] id=${incident.id} viaje=${idTrip} usuario=${userId} tipo=${data.kind} fotos=${saved.length}`);
        return formatIncident(incident);
    } catch (err) {
        await Promise.all(saved.map((fileName) => deletePhotoFile(folderOf(idTrip), fileName)));
        throw err;
    }
}

export const listMyIncidents = async (userId: number, idTrip: number) => {
    await assertTripParticipant(idTrip, userId);
    const incidents = await prisma.incidentReport.findMany({
        where: { id_client_request: idTrip, id_reporter: userId },
        orderBy: { id: "asc" },
        include: { photos: { select: { id: true } } }
    });
    return incidents.map(formatIncident);
}

// Ruta en disco de una foto del reporte, solo para quien lo hizo
export const getIncidentPhotoFile = async (userId: number, idTrip: number, idIncident: number, idPhoto: number) => {
    const photo = await prisma.incidentPhoto.findFirst({
        where: { id: idPhoto, id_incident: idIncident, incident: { id_client_request: idTrip } },
        include: { incident: { select: { id_reporter: true } } }
    });
    if (!photo) {
        throw new AppError("La foto no existe", 404);
    }
    if (photo.incident.id_reporter !== userId) {
        throw deny(userId, "ver-foto-incidente", `incident_photos/${idPhoto}`);
    }
    return photoPath(folderOf(idTrip), photo.file_name);
}
