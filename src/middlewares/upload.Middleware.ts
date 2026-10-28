import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { AppError } from "../utils/App.Error.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const idUser = req.params.id;
        const uploadPath = path.join(__dirname, `../../public/uploads/users/${idUser}`);
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `profile${ext}`);
    }
});

// Una foto de perfil no necesita más de 5 MB; sin límite se llegaron a guardar fotos de 9 MB que tardan en cargar
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const upload = multer({
    storage,
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (!allowed.includes(file.mimetype)) {
           return cb(new AppError("Solo se permiten archivos JPEG, PNG o JPG", 400));
        }
        cb(null, true);
    }
});