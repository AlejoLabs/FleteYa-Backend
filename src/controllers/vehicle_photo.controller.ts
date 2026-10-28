import type { Request, Response, NextFunction } from "express";
import * as vehiclePhotoService from "../services/vehicle_photo.service.js";
import { getUserId } from "../utils/authorization.js";


// El conductor siempre sube y borra fotos de su propio vehículo: el id sale del token
export const uploadVehiclePhoto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const photo = await vehiclePhotoService.addVehiclePhoto(getUserId(req), req.file);
        return res.status(201).json(photo);
    } catch (err) {
        next(err);
    }
}

export const deleteVehiclePhoto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await vehiclePhotoService.deleteVehiclePhoto(getUserId(req), Number(req.params.photoId));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const listVehiclePhotos = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const photos = await vehiclePhotoService.listVehiclePhotos(Number(req.params.id_driver));
        return res.status(200).json(photos);
    } catch (err) {
        next(err);
    }
}

export const getVehiclePhotoFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = await vehiclePhotoService.getVehiclePhotoFile(Number(req.params.id_driver), Number(req.params.photoId));
        res.setHeader("Cache-Control", "private, max-age=3600");
        return res.sendFile(filePath);
    } catch (err) {
        next(err);
    }
}
