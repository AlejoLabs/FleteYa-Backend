import express from "express";
import { getTimeAndDistance } from "../controllers/client_request.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();

router.get("/", authMiddleware, getTimeAndDistance);

export default router;