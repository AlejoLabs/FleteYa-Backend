import type { Request, Response, NextFunction } from "express";
import * as clientRequestService from "../services/client_request_service.js";
import { AppError } from "../utils/App.Error.js";


export const getTimeAndDistance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await clientRequestService.getTimeAndDistance();
        return res.status(200).json(data);
    } catch (err) {
        next(err);    
    }

}
