import express from "express";
import { getTimeAndDistance, createClientRequest } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createClientRequestSchema } from "../validators/client_request.validator.js";



const router = express.Router();

router.get("/:origin_lat/:origin_lng/:destination_lat/:destination_lng", authMiddleware, getTimeAndDistance);
router.post("/", authMiddleware, validateBody(createClientRequestSchema), createClientRequest);

export default router;