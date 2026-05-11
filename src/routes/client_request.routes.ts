import express from "express";
import { getTimeAndDistance, createClientRequest, getNearbyClientRequests, assignDriver, getByClientRequest, updateClientRequest, updateClientRating, updateDriverRating } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createClientRequestSchema } from "../validators/client_request.validator.js";



const router = express.Router();

router.get("/:origin_lat/:origin_lng/:destination_lat/:destination_lng", authMiddleware, getTimeAndDistance);
router.post("/", authMiddleware, validateBody(createClientRequestSchema), createClientRequest);
router.get("/:driver_lat/:driver_lng", authMiddleware, getNearbyClientRequests);
router.get("/:id", authMiddleware, getByClientRequest);
router.put("/updateDriverAssigned", authMiddleware, assignDriver);
router.put("/update_client_rating", authMiddleware, updateClientRating);
router.put("/update_driver_rating", authMiddleware, updateDriverRating);
router.put("/update_status", authMiddleware, updateClientRequest);

export default router;