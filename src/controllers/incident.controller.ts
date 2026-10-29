import type { Request, Response, NextFunction } from "express";
import * as incidentService from "../services/incident.service.js";
import { getUserId } from "../utils/authorization.js";


export const createIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        const incident = await incidentService.createIncident(getUserId(req), Number(req.params.id), req.body, files);
        return res.status(201).json(incident);
    } catch (err) {
        next(err);
    }
}

export const listMyIncidents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const incidents = await incidentService.listMyIncidents(getUserId(req), Number(req.params.id));
        return res.status(200).json(incidents);
    } catch (err) {
        next(err);
    }
}

export const getIncidentPhotoFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filePath = await incidentService.getIncidentPhotoFile(
            getUserId(req), Number(req.params.id), Number(req.params.incidentId), Number(req.params.photoId)
        );
        res.setHeader("Cache-Control", "private, max-age=3600");
        return res.sendFile(filePath);
    } catch (err) {
        next(err);
    }
}
