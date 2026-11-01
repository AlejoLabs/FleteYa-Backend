import express from "express";
import { getTimeAndDistance, createClientRequest, getNearbyClientRequests, assignDriver, getByClientRequest, updateClientRequest, updateClientRating, updateDriverRating, getByDriverAssigned, getByClientAssigned, raiseFare, cancelClientRequest, dismissClientRequest, getMyActiveTrips, deliverClientRequest, confirmDelivery } from "../controllers/client_request.controller.js";
import { deleteTripPhoto, getTripPhotoFile, listTripPhotos, uploadTripPhoto } from "../controllers/trip_photo.controller.js";
import { listTripMessages, markTripMessagesRead, sendTripMessage } from "../controllers/trip_message.controller.js";
import { createIncident, getIncidentPhotoFile, listMyIncidents } from "../controllers/incident.controller.js";
import { changePaymentMethod, confirmCashPayment, getPaymentStatus, startOnlinePayment, verifyOnlinePayments } from "../controllers/payment.controller.js";
import { MAX_INCIDENT_PHOTOS } from "../services/incident.service.js";
import { makePhotoUpload, photoUpload } from "../utils/photoStorage.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { assignDriverSchema, cancelClientRequestSchema, paymentMethodSchema, createClientRequestSchema, deliverSchema, incidentSchema, tripMessageSchema, tripPhotoSchema, raiseFareSchema, updateClientRatingSchema, updateClientRequestSchema, updateDriverRatingSchema } from "../validators/client_request.validator.js";
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
// Chat del viaje
router.get("/:id/messages", authMiddleware, listTripMessages);
router.post("/:id/messages", authMiddleware, validateBody(tripMessageSchema), sendTripMessage);
router.put("/:id/messages/read", authMiddleware, markTripMessagesRead);
// Reportes de incidentes, con hasta 4 fotos en el campo "photos"
router.post("/:id/incidents", authMiddleware, makePhotoUpload(MAX_INCIDENT_PHOTOS).array("photos", MAX_INCIDENT_PHOTOS), validateBody(incidentSchema), createIncident);
router.get("/:id/incidents", authMiddleware, listMyIncidents);
router.get("/:id/incidents/:incidentId/photos/:photoId", authMiddleware, getIncidentPhotoFile);
// Pago al terminar el viaje: en efectivo (lo confirma el conductor) o por la app (Wompi o el simulador)
router.get("/:id/payment", authMiddleware, getPaymentStatus);
router.put("/:id/payment/method", authMiddleware, validateBody(paymentMethodSchema), changePaymentMethod);
router.post("/:id/payment/online", authMiddleware, startOnlinePayment);
router.post("/:id/payment/online/verify", authMiddleware, verifyOnlinePayments);
router.post("/:id/payment/cash", authMiddleware, requireRole("DRIVER"), confirmCashPayment);
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
