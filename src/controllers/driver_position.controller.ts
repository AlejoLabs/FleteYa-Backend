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

