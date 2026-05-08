import express from "express";
import { createDriverTripOffer, getByClientRequest} from "../controllers/driver_trip_offer.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";



const router = express.Router();
router.post("/", authMiddleware, createDriverTripOffer);
router.get("/findByClientRequest/:id_client_request", authMiddleware, getByClientRequest);
    

export default router;