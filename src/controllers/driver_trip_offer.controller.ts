import type { Request, Response, NextFunction } from "express";
import * as driverTripOfferService from "../services/driver_trip_offer.service.js";
import { AppError } from "../utils/App.Error.js";


export const createDriverTripOffer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = req.body;
        const driverTripOffer = await driverTripOfferService.createDriverTripOffer(data);
        return res.status(201).json(driverTripOffer);
    } catch (err) {
        next(err);    
    }

}
