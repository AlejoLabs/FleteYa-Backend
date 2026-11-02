import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { photoPath } from "../../utils/photoStorage.js";
import { notifyUser } from "../../sockets/socketHandler.js";
import { logAdminAction } from "./admin_audit.service.js";

// Incidentes reportados por clientes y conductores: el admin los revisa con sus fotos y los marca en revisión o resueltos

type IncidentStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";

const nameOf = (user: { name: string; lastname: string }) => `${user.name} ${user.lastname}`.trim();

export const listIncidents = async (status?: IncidentStatus) => {
    const rows = await prisma.incidentReport.findMany({
        where: status ? { status } : {},
        // Los abiertos y más viejos primero: son los que llevan más tiempo esperando
        orderBy: status === "RESOLVED" ? { update_at: "desc" } : { created_at: "asc" },
        select: {
            id: true, kind: true, status: true, description: true, created_at: true, id_client_request: true,
            reporter: { select: { id: true, name: true, lastname: true } },
            _count: { select: { photos: true } },
        },
    });
    return rows.map((row) => ({
        id: row.id, kind: row.kind, status: row.status, created_at: row.created_at, id_client_request: row.id_client_request,
        summary: row.description.slice(0, 140), reporter: nameOf(row.reporter), id_reporter: row.reporter.id, photos: row._count.photos,
    }));
}

export const getIncident = async (id: number) => {
    const incident = await prisma.incidentReport.findUnique({
        where: { id },
        include: {
            reporter: { select: { id: true, name: true, lastname: true, email: true } },
            photos: { select: { id: true } },
            client_request: { select: { id: true, status: true, id_client: true, id_driver_assigned: true, pickup_description: true, destination_description: true } },
        },
    });
    if (!incident) {
        throw new AppError("El reporte no existe", 404);
    }
    const { reporter, photos, client_request, ...rest } = incident;
    return {
        ...rest,
        reporter: { id: reporter.id, name: nameOf(reporter), email: reporter.email },
        reporter_role: client_request.id_client === reporter.id ? "CLIENT" : "DRIVER",
        trip: client_request,
        photos: photos.map((photo) => ({ id: photo.id, url: `/admin/api/incidents/${id}/photos/${photo.id}` })),
    };
}

export const getIncidentPhotoFile = async (id: number, idPhoto: number) => {
    const photo = await prisma.incidentPhoto.findFirst({
        where: { id: idPhoto, id_incident: id },
        select: { file_name: true, incident: { select: { id_client_request: true } } },
    });
    if (!photo) {
        throw new AppError("La foto no existe", 404);
    }
    return photoPath(`trips/${photo.incident.id_client_request}/incidents`, photo.file_name);
}

export const updateIncidentStatus = async (adminId: number, id: number, status: IncidentStatus) => {
    const incident = await prisma.incidentReport.findUnique({ where: { id }, select: { status: true, id_reporter: true, id_client_request: true } });
    if (!incident) {
        throw new AppError("El reporte no existe", 404);
    }
    if (incident.status === status) {
        return { id, status };
    }
    await prisma.$transaction(async (tx) => {
        await tx.incidentReport.update({ where: { id }, data: { status } });
        await logAdminAction(tx, adminId, "UPDATE_INCIDENT", "incident", id, `${incident.status} → ${status}`);
    });
    // Quien lo reportó ve el nuevo estado en la app si tiene abierto el viaje
    notifyUser(incident.id_reporter, `incident_updated/${incident.id_client_request}`, { id, status });
    return { id, status };
}
