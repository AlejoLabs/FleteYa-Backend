import type { Request, Response, NextFunction } from "express";
import * as tripMessageService from "../services/trip_message.service.js";
import { getUserId } from "../utils/authorization.js";


export const listTripMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const messages = await tripMessageService.listMessages(getUserId(req), Number(req.params.id));
        return res.status(200).json(messages);
    } catch (err) {
        next(err);
    }
}

export const sendTripMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const message = await tripMessageService.sendMessage(getUserId(req), Number(req.params.id), req.body.text);
        return res.status(201).json(message);
    } catch (err) {
        next(err);
    }
}

export const markTripMessagesRead = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await tripMessageService.markMessagesRead(getUserId(req), Number(req.params.id));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}
