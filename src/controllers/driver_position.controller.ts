import type { Request, Response, NextFunction } from "express";
import * as driverPositionService from "../services/driver_position.service.js";
import { AppError } from "../utils/App.Error.js";


export const create = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = req.body;
        const driverPosition = await driverPositionService.createDriverPosition(data);
        return res.status(201).json(driverPosition);
    } catch (err) {
        next(err);    
    }

}

export const getDriverPosition = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_driver = Number(req.params.id_driver);
        const driverPosition = await driverPositionService.getDriverPosition(id_driver);
        return res.status(200).json(driverPosition);
    } catch (err) {
        next(err);    
    }

}

export const getNearbyDrivers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lat = Number(req.params.lat);
        const lng = Number(req.params.lng);
        const driverPositon = await driverPositionService.getNearbyDrivers(lat, lng);
        return res.status(200).json(driverPositon);
    } catch (err) {
        next(err);    
    }

}

export const deleteDriverPosition = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_driver = Number(req.params.id_driver);
        await driverPositionService.deleteDriverPosition(id_driver);
        return res.status(200).json(true);
    } catch (err) {
        next(err);    
    }

}

