import express from "express";
import { createDriverCarInfo, getByDriver } from "../controllers/driver_car_info.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();

router.post("/", authMiddleware, createDriverCarInfo);
router.get("/:id_driver", authMiddleware, getByDriver);
    

export default router;