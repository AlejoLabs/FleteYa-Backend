import express from "express";
import { create, deleteDriverPosition, getDriverPosition, getNearbyDrivers } from "../controllers/driver_position.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();
router.post("/", authMiddleware, create);
router.get("/:id_driver", authMiddleware, getDriverPosition);
router.get("/:lat/:lng", authMiddleware, getNearbyDrivers);
router.delete("/:id_driver", authMiddleware, deleteDriverPosition);

export default router;