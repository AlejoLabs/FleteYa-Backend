import type { Request, Response, NextFunction } from "express";
import * as paymentService from "../services/payment.service.js";
import { getUserId } from "../utils/authorization.js";

export const getPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await paymentService.getPaymentStatus(getUserId(req), Number(req.params.id)));
    } catch (err) {
        next(err);
    }
}

export const changePaymentMethod = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await paymentService.changePaymentMethod(getUserId(req), Number(req.params.id), req.body.payment_method));
    } catch (err) {
        next(err);
    }
}

export const startOnlinePayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(201).json(await paymentService.startWompiPayment(getUserId(req), Number(req.params.id)));
    } catch (err) {
        next(err);
    }
}

export const verifyOnlinePayments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await paymentService.verifyWompiPayments(getUserId(req), Number(req.params.id)));
    } catch (err) {
        next(err);
    }
}

export const confirmCashPayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await paymentService.confirmCashPayment(getUserId(req), Number(req.params.id)));
    } catch (err) {
        next(err);
    }
}
