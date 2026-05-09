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

export const getByDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const  idDriver = Number(req.params.id_driver);
        const driverCarInfo = await driverCarInfoService.getByDriver(idDriver);
        return res.status(200).json(driverCarInfo);
    } catch (err) {
        next(err);    
    }
}
