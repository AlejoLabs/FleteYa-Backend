import express from "express";
import { create } from "../controllers/driver_position.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();
router.post("/", authMiddleware, create);

export default router;