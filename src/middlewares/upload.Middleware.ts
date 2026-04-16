import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";


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

export const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/jpg"];
        if (!allowed.includes(file.mimetype)) {
           return cb(new Error("Solo se permiten archivos JPEG, PNG o JPG"));
        }
        cb(null, true);
    } 
});