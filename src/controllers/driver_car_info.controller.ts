import type { Request, Response, NextFunction } from "express";
import * as driverCarInfoService from "../services/driver_car_info.service.js";
import { AppError } from "../utils/App.Error.js";


export const createDriverCarInfo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = req.body;
        const driverCarInfo = await driverCarInfoService.createDriverCarInfo(data);
        return res.status(201).json(driverCarInfo);
    } catch (err) {
        next(err);    
    }

}
