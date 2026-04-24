import express from "express";
import { create, getDriverPosition } from "../controllers/driver_position.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();
router.post("/", authMiddleware, create);
router.get("/:id_driver", authMiddleware, getDriverPosition);

export default router;