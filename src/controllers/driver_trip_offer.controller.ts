import type { Request, Response, NextFunction } from "express";
import * as driverTripOfferService from "../services/driver_trip_offer.service.js";
import { assertTripOwner } from "../services/client_request.shared.js";
import { getUserId } from "../utils/authorization.js";


export const createDriverTripOffer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const driverTripOffer = await driverTripOfferService.createDriverTripOffer(getUserId(req), req.body);
        return res.status(201).json(driverTripOffer);
    } catch (err) {
        next(err);
    }

}

export const rejectOffer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await driverTripOfferService.rejectOffer(getUserId(req), Number(req.params.id));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const withdrawOffer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await driverTripOfferService.withdrawOffer(getUserId(req), Number(req.params.id));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const getByClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_client_request = Number(req.params.id_client_request);
        await assertTripOwner(id_client_request, getUserId(req));
        const result = await driverTripOfferService.getByClientRequest(id_client_request);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }

}
