import express from "express";
import { getTimeAndDistance, createClientRequest, getNearbyClientRequests, assignDriver } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createClientRequestSchema } from "../validators/client_request.validator.js";



const router = express.Router();

router.get("/:origin_lat/:origin_lng/:destination_lat/:destination_lng", authMiddleware, getTimeAndDistance);
router.post("/", authMiddleware, validateBody(createClientRequestSchema), createClientRequest);
router.get("/:driver_lat/:driver_lng", authMiddleware, getNearbyClientRequests);
router.put("/updateDriverAssigned", authMiddleware, assignDriver);

export default router;