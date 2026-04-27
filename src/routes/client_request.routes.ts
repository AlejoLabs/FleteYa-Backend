import express from "express";
import { getTimeAndDistance } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();

router.get("/:origin_lat/:origin_lng/:destination_lat/:destination_lng", authMiddleware, getTimeAndDistance);

export default router;