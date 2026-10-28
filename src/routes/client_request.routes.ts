import express from "express";
import { getTimeAndDistance, createClientRequest, getNearbyClientRequests, assignDriver, getByClientRequest, updateClientRequest, updateClientRating, updateDriverRating, getByDriverAssigned, getByClientAssigned } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { assignDriverSchema, createClientRequestSchema, updateClientRatingSchema, updateClientRequestSchema, updateDriverRatingSchema } from "../validators/client_request.validator.js";
import { requireRole, requireSelfParam } from "../utils/authorization.js";



const router = express.Router();

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
