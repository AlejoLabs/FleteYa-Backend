import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny, hasRole } from "../utils/authorization.js";
import { deletePhotoFile, photoPath, savePhoto } from "../utils/photoStorage.js";
import { notifyUser } from "../sockets/socketHandler.js";
import type { TripPhotoKind } from "../generated/prisma/enums.js";
import { findTripOrFail } from "./client_request.shared.js";

// Fotos del flete: la carga (cliente, al pedirlo), al cargar y al entregar (conductor, como prueba de entrega)

const MAX_PHOTOS: Record<TripPhotoKind, number> = { CARGO: 4, PICKUP: 3, DELIVERY: 3 };

type Trip = Awaited<ReturnType<typeof findTripOrFail>>;

const folderOf = (idTrip: number) => `trips/${idTrip}`;

const formatPhoto = (photo: { id: number; id_client_request: number; kind: TripPhotoKind; created_at: Date }) => ({
    id: photo.id,
    kind: photo.kind,
    created_at: photo.created_at,
    url: `/client-requests/${photo.id_client_request}/photos/${photo.id}`,
});

// Quién sube cada tipo de foto y en qué momento del viaje
const assertCanUpload = (trip: Trip, userId: number, kind: TripPhotoKind) => {
    if (kind === "CARGO") {
        if (trip.id_client !== userId) throw deny(userId, "foto-carga", `client_requests/${trip.id}`);
        if (trip.status !== "CREATED") throw new AppError("CARGO_PHOTOS_WHILE_SEARCHING", 409);
        return;
    }
    if (trip.id_driver_assigned !== userId) throw deny(userId, `foto-${kind.toLowerCase()}`, `client_requests/${trip.id}`);
    if (kind === "PICKUP" && trip.status !== "ARRIVED") {
        throw new AppError("PICKUP_PHOTO_ON_ARRIVAL", 409);
    }
    if (kind === "DELIVERY" && trip.status !== "TRAVELING") {
        throw new AppError("DELIVERY_PHOTO_ON_BOARD", 409);
    }
}

// El cliente y el conductor asignado ven todas. Mientras busca conductor, cualquier conductor ve las de la carga para decidir si oferta
const visibleKinds = async (trip: Trip, userId: number): Promise<TripPhotoKind[]> => {
    if (trip.id_client === userId || trip.id_driver_assigned === userId) return ["CARGO", "PICKUP", "DELIVERY"];
    if (trip.status === "CREATED" && await hasRole(userId, "DRIVER")) return ["CARGO"];
    throw deny(userId, "ver-fotos", `client_requests/${trip.id}`);
}

export const addTripPhoto = async (userId: number, idTrip: number, kind: TripPhotoKind, file?: Express.Multer.File) => {
    const trip = await findTripOrFail(idTrip);
    assertCanUpload(trip, userId, kind);

    const count = await prisma.tripPhoto.count({ where: { id_client_request: idTrip, kind } });
    if (count >= MAX_PHOTOS[kind]) {
        throw new AppError("PHOTO_LIMIT_REACHED", 409, undefined, { max: MAX_PHOTOS[kind] });
    }

    const fileName = await savePhoto(folderOf(idTrip), file);
    const photo = await prisma.tripPhoto.create({
        data: { id_client_request: idTrip, id_user: userId, kind, file_name: fileName }
    });

    // El cliente ve en vivo las fotos que toma el conductor al cargar y al entregar
    if (kind !== "CARGO") {
        notifyUser(trip.id_client, `trip_photo/${idTrip}`, { id_client_request: idTrip, kind });
    }
    return formatPhoto(photo);
}

export const countTripPhotos = (idTrip: number, kind: TripPhotoKind) =>
    prisma.tripPhoto.count({ where: { id_client_request: idTrip, kind } });

export const listTripPhotos = async (userId: number, idTrip: number) => {
    const trip = await findTripOrFail(idTrip);
    const kinds = await visibleKinds(trip, userId);
    const photos = await prisma.tripPhoto.findMany({
        where: { id_client_request: idTrip, kind: { in: kinds } },
        orderBy: { created_at: "asc" }
    });
    return photos.map(formatPhoto);
}

// Devuelve la ruta en disco para enviarla con res.sendFile, solo si el usuario puede verla
export const getTripPhotoFile = async (userId: number, idTrip: number, idPhoto: number) => {
    const trip = await findTripOrFail(idTrip);
    const kinds = await visibleKinds(trip, userId);
    const photo = await prisma.tripPhoto.findFirst({ where: { id: idPhoto, id_client_request: idTrip } });
    if (!photo || !kinds.includes(photo.kind)) {
        throw new AppError("PHOTO_NOT_FOUND", 404);
    }
    return photoPath(folderOf(idTrip), photo.file_name);
}

// El cliente puede quitar una foto de la carga mientras busca conductor; las de prueba de entrega no se borran
export const deleteTripPhoto = async (userId: number, idTrip: number, idPhoto: number) => {
    const trip = await findTripOrFail(idTrip);
    const photo = await prisma.tripPhoto.findFirst({ where: { id: idPhoto, id_client_request: idTrip } });
    if (!photo) {
        throw new AppError("PHOTO_NOT_FOUND", 404);
    }
    if (photo.kind !== "CARGO" || trip.id_client !== userId) {
        throw deny(userId, "borrar-foto", `trip_photos/${idPhoto}`);
    }
    if (trip.status !== "CREATED") {
        throw new AppError("CARGO_PHOTOS_LOCKED", 409);
    }
    await prisma.tripPhoto.delete({ where: { id: idPhoto } });
    await deletePhotoFile(folderOf(idTrip), photo.file_name);
    return { id: idPhoto, deleted: true };
}
