import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deletePhotoFile, photoPath, savePhoto } from "../utils/photoStorage.js";

// Fotos del vehículo del conductor: las sube él mismo y las ve cualquier usuario con sesión (el cliente compara ofertas)

const MAX_VEHICLE_PHOTOS = 4;

const folderOf = (idDriver: number) => `vehicles/${idDriver}`;

const formatPhoto = (photo: { id: number; id_driver: number; created_at: Date }) => ({
    id: photo.id,
    created_at: photo.created_at,
    url: `/driver-car-info/${photo.id_driver}/photos/${photo.id}`,
});

export const addVehiclePhoto = async (idDriver: number, file?: Express.Multer.File) => {
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { id_driver: true } });
    if (!car) {
        throw new AppError("REGISTER_VEHICLE_FIRST", 404);
    }
    const count = await prisma.vehiclePhoto.count({ where: { id_driver: idDriver } });
    if (count >= MAX_VEHICLE_PHOTOS) {
        throw new AppError("VEHICLE_PHOTO_LIMIT", 409, undefined, { max: MAX_VEHICLE_PHOTOS });
    }
    const fileName = await savePhoto(folderOf(idDriver), file);
    const photo = await prisma.vehiclePhoto.create({ data: { id_driver: idDriver, file_name: fileName } });
    return formatPhoto(photo);
}

export const listVehiclePhotos = async (idDriver: number) => {
    const photos = await prisma.vehiclePhoto.findMany({ where: { id_driver: idDriver }, orderBy: { created_at: "asc" } });
    return photos.map(formatPhoto);
}

export const getVehiclePhotoFile = async (idDriver: number, idPhoto: number) => {
    const photo = await prisma.vehiclePhoto.findFirst({ where: { id: idPhoto, id_driver: idDriver } });
    if (!photo) {
        throw new AppError("PHOTO_NOT_FOUND", 404);
    }
    return photoPath(folderOf(idDriver), photo.file_name);
}

// Solo el dueño borra sus fotos: el where con id_driver hace que una foto ajena responda "no existe"
export const deleteVehiclePhoto = async (idDriver: number, idPhoto: number) => {
    const photo = await prisma.vehiclePhoto.findFirst({ where: { id: idPhoto, id_driver: idDriver } });
    if (!photo) {
        throw new AppError("PHOTO_NOT_FOUND", 404);
    }
    await prisma.vehiclePhoto.delete({ where: { id: idPhoto } });
    await deletePhotoFile(folderOf(idDriver), photo.file_name);
    return { id: idPhoto, deleted: true };
}
