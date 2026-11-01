import express from "express";
import { createDriverCarInfo, getByDriver, getMyDocuments, updateMyDocuments, updateMyVehicle } from "../controllers/driver_car_info.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createDriverCarInfoSchema, updateDocumentsSchema, updateVehicleSchema } from "../validators/driver_car_info.validator.js";
import { requireRole } from "../utils/authorization.js";
import { deleteVehiclePhoto, getVehiclePhotoFile, listVehiclePhotos, uploadVehiclePhoto } from "../controllers/vehicle_photo.controller.js";
import { photoUpload } from "../utils/photoStorage.js";



const router = express.Router();

router.post("/", authMiddleware, requireRole("DRIVER"), validateBody(createDriverCarInfoSchema), createDriverCarInfo);
// Fotos del vehículo: "me" va antes de "/:id_driver" para que no se lea como un id
router.get("/me/documents", authMiddleware, requireRole("DRIVER"), getMyDocuments);
// Cambiar de vehículo (tipo, datos y capacidad real) y renovar los documentos
router.put("/me", authMiddleware, requireRole("DRIVER"), validateBody(updateVehicleSchema), updateMyVehicle);
router.put("/me/documents", authMiddleware, requireRole("DRIVER"), validateBody(updateDocumentsSchema), updateMyDocuments);
router.post("/me/photos", authMiddleware, requireRole("DRIVER"), photoUpload.single("file"), uploadVehiclePhoto);
router.delete("/me/photos/:photoId", authMiddleware, requireRole("DRIVER"), deleteVehiclePhoto);
router.get("/:id_driver/photos", authMiddleware, listVehiclePhotos);
router.get("/:id_driver/photos/:photoId", authMiddleware, getVehiclePhotoFile);
// Cualquier usuario con sesión puede ver el vehículo: el cliente lo necesita para comparar ofertas
router.get("/:id_driver", authMiddleware, getByDriver);


export default router;
