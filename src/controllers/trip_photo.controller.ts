import type { Request, Response, NextFunction } from "express";
import * as tripPhotoService from "../services/trip_photo.service.js";
import { getUserId } from "../utils/authorization.js";


export const uploadTripPhoto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const photo = await tripPhotoService.addTripPhoto(getUserId(req), Number(req.params.id), req.body.kind, req.file);
        return res.status(201).json(photo);
    } catch (err) {
        next(err);
    }
}

export const listTripPhotos = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const photos = await tripPhotoService.listTripPhotos(getUserId(req), Number(req.params.id));
        return res.status(200).json(photos);
    } catch (err) {
        next(err);
    }
}

export const getTripPhotoFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = await tripPhotoService.getTripPhotoFile(getUserId(req), Number(req.params.id), Number(req.params.photoId));
        // Privada: que ningún proxy ni el navegador la guarde para otros
        res.setHeader("Cache-Control", "private, max-age=3600");
        return res.sendFile(filePath);
    } catch (err) {
        next(err);
    }
}

export const deleteTripPhoto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await tripPhotoService.deleteTripPhoto(getUserId(req), Number(req.params.id), Number(req.params.photoId));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}
