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

export const assignDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body;
        const data = await clientRequestService.assignDriver(body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);    
    }

}

export const updateClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body;
        const data = await clientRequestService.updateStatus(body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);    
    }

}

export const updateClientRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body;
        const result = await clientRequestService.updateClientRating(body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const updateDriverRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = req.body;
        const result = await clientRequestService.updateDriverRating(body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getNearbyClientRequests = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const driverLat = Number(req.params.driver_lat);
        const driverLng = Number(req.params.driver_lng);
        const result = await clientRequestService.getNearbyClientRequests(driverLat, driverLng);
        return res.status(200).json(result);
    } catch (err) {
        next(err);    
    }

}

export const getByClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        const result = await clientRequestService.getByClientRequest(id);
        return res.status(200).json(result);
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
