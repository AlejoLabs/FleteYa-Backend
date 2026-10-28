import express from "express";
import { createDriverCarInfo, getByDriver } from "../controllers/driver_car_info.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createDriverCarInfoSchema } from "../validators/driver_car_info.validator.js";
import { requireRole } from "../utils/authorization.js";



const router = express.Router();

router.post("/", authMiddleware, requireRole("DRIVER"), validateBody(createDriverCarInfoSchema), createDriverCarInfo);
// Cualquier usuario con sesión puede ver el vehículo: el cliente lo necesita para comparar ofertas
router.get("/:id_driver", authMiddleware, getByDriver);


export default router;
