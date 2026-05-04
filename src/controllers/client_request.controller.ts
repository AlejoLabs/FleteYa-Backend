import type { Request, Response, NextFunction } from "express";
import * as clientRequestService from "../services/client_request_service.js";
import { AppError } from "../utils/App.Error.js";


export const createClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body;
        const data = await clientRequestService.createClientRequest(body);
        return res.status(201).json(data);
    } catch (err) {
        next(err);    
    }

}

export const getTimeAndDistance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const originLat = Number(req.params.origin_lat);
        const originLng = Number(req.params.origin_lng);
        const destinationLat = Number(req.params.destination_lat);
        const destinationLng = Number(req.params.destination_lng);
        const data = await clientRequestService.getTimeAndDistance(originLat, originLng, destinationLat, destinationLng);
        return res.status(200).json(data);
    } catch (err) {
        next(err);    
    }

}
