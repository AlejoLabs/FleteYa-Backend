import express from "express";
import { createDriverTripOffer, getByClientRequest, rejectOffer, withdrawOffer } from "../controllers/driver_trip_offer.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createDriverTripOfferSchema } from "../validators/driver_trip_offer.validator.js";
import { requireRole } from "../utils/authorization.js";



const router = express.Router();
router.post("/", authMiddleware, requireRole("DRIVER"), validateBody(createDriverTripOfferSchema), createDriverTripOffer);
router.get("/findByClientRequest/:id_client_request", authMiddleware, getByClientRequest);
router.put("/:id/reject", authMiddleware, rejectOffer);
router.put("/:id/withdraw", authMiddleware, requireRole("DRIVER"), withdrawOffer);


export default router;
