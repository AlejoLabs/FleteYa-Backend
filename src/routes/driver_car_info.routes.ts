import express from "express";
import { createDriverCarInfo } from "../controllers/driver_car_info.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();

router.post("/", authMiddleware, createDriverCarInfo);
    

export default router;