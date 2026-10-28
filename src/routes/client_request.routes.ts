import express from "express";
import { getTimeAndDistance, createClientRequest, getNearbyClientRequests, assignDriver, getByClientRequest, updateClientRequest, updateClientRating, updateDriverRating, getByDriverAssigned, getByClientAssigned, raiseFare, cancelClientRequest, dismissClientRequest, getMyActiveTrips, deliverClientRequest, confirmDelivery } from "../controllers/client_request.controller.js";
import { deleteTripPhoto, getTripPhotoFile, listTripPhotos, uploadTripPhoto } from "../controllers/trip_photo.controller.js";
import { photoUpload } from "../utils/photoStorage.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { assignDriverSchema, cancelClientRequestSchema, createClientRequestSchema, deliverSchema, tripPhotoSchema, raiseFareSchema, updateClientRatingSchema, updateClientRequestSchema, updateDriverRatingSchema } from "../validators/client_request.validator.js";
import { requireRole, requireSelfParam } from "../utils/authorization.js";



const router = express.Router();

// Va antes de "/:driver_lat/:driver_lng", que también tiene dos segmentos y se lo tragaría
router.get("/me/active", authMiddleware, getMyActiveTrips);
router.put("/:id/fare", authMiddleware, validateBody(raiseFareSchema), raiseFare);
router.put("/:id/cancel", authMiddleware, validateBody(cancelClientRequestSchema), cancelClientRequest);
router.post("/:id/dismiss", authMiddleware, requireRole("DRIVER"), dismissClientRequest);
router.post("/:id/deliver", authMiddleware, validateBody(deliverSchema), deliverClientRequest);
router.put("/:id/confirm-delivery", authMiddleware, confirmDelivery);
// Fotos del flete. authMiddleware va antes de multer: sin sesión el archivo ni se lee
router.post("/:id/photos", authMiddleware, photoUpload.single("file"), validateBody(tripPhotoSchema), uploadTripPhoto);
router.get("/:id/photos", authMiddleware, listTripPhotos);
router.get("/:id/photos/:photoId", authMiddleware, getTripPhotoFile);
router.delete("/:id/photos/:photoId", authMiddleware, deleteTripPhoto);
router.get("/:origin_lat/:origin_lng/:destination_lat/:destination_lng", authMiddleware, getTimeAndDistance);
router.post("/", authMiddleware, requireRole("CLIENT"), validateBody(createClientRequestSchema), createClientRequest);
router.get("/:driver_lat/:driver_lng", authMiddleware, requireRole("DRIVER"), getNearbyClientRequests);
router.get("/:id", authMiddleware, getByClientRequest);
router.put("/updateDriverAssigned", authMiddleware, validateBody(assignDriverSchema), assignDriver);
router.put("/update_client_rating", authMiddleware, validateBody(updateClientRatingSchema), updateClientRating);
router.put("/update_driver_rating", authMiddleware, validateBody(updateDriverRatingSchema), updateDriverRating);
router.put("/update_status", authMiddleware, validateBody(updateClientRequestSchema), updateClientRequest);
router.get("/client/assigned/:id_client", authMiddleware, requireSelfParam("id_client"), getByClientAssigned);
router.get("/driver/assigned/:id_driver_assigned", authMiddleware, requireSelfParam("id_driver_assigned"), getByDriverAssigned);

export default router;
