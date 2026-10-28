import type { Request, Response, NextFunction } from "express";
import * as driverCarInfoService from "../services/driver_car_info.service.js";
import { getUserId } from "../utils/authorization.js";


export const createDriverCarInfo = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const driverCarInfo = await driverCarInfoService.createDriverCarInfo(getUserId(req), req.body);
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
