import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { AppError } from "./App.Error.js";

// Fotos de viajes y vehículos. Van en storage/, fuera de public/, para servirlas solo a quien tiene permiso
const STORAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../storage");

// La app las comprime antes de subirlas (unos 300 KB); 5 MB es solo el tope
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// En memoria: el archivo se escribe en disco solo después de revisar permisos y que de verdad sea una imagen
export const makePhotoUpload = (maxFiles: number) => multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: maxFiles },
    fileFilter: (req, file, cb) => {
        if (!["image/jpeg", "image/jpg", "image/png"].includes(file.mimetype)) {
            return cb(new AppError("ONLY_JPG_PNG_PHOTOS", 400));
        }
        cb(null, true);
    }
});

export const photoUpload = makePhotoUpload(1);

// El tipo que manda el teléfono se puede falsificar: se revisan los primeros bytes del archivo
const detectExtension = (buffer: Buffer): "jpg" | "png" | null => {
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
    if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
    return null;
}

// Guarda la foto con un nombre aleatorio (nunca el que manda el teléfono) y devuelve ese nombre
export const savePhoto = async (folder: string, file?: Express.Multer.File): Promise<string> => {
    if (!file) {
        throw new AppError("ATTACH_PHOTO", 400);
    }
    const extension = detectExtension(file.buffer);
    if (!extension) {
        throw new AppError("INVALID_PHOTO_FILE", 400);
    }
    const fileName = `${crypto.randomUUID()}.${extension}`;
    await fs.mkdir(path.join(STORAGE_ROOT, folder), { recursive: true });
    await fs.writeFile(path.join(STORAGE_ROOT, folder, fileName), file.buffer);
    return fileName;
}

export const photoPath = (folder: string, fileName: string) => path.join(STORAGE_ROOT, folder, fileName);

export const deletePhotoFile = async (folder: string, fileName: string) => {
    await fs.rm(photoPath(folder, fileName), { force: true });
}
