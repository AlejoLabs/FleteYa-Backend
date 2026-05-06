import express from "express";
import { createDriverTripOffer} from "../controllers/driver_trip_offer.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();
router.post("/", authMiddleware, createDriverTripOffer);
    

export default router;