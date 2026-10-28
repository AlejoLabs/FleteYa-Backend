import express from "express";
import { create, deleteDriverPosition, getDriverPosition, getNearbyDrivers } from "../controllers/driver_position.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createDriverPositionSchema } from "../validators/driver_position_validator.js";
import { requireRole, requireSelfParam } from "../utils/authorization.js";



const router = express.Router();
router.post("/", authMiddleware, requireRole("DRIVER"), validateBody(createDriverPositionSchema), create);
router.get("/:id_driver", authMiddleware, requireSelfParam("id_driver"), getDriverPosition);
router.get("/:lat/:lng", authMiddleware, getNearbyDrivers);
router.delete("/:id_driver", authMiddleware, requireSelfParam("id_driver"), deleteDriverPosition);

export default router;
