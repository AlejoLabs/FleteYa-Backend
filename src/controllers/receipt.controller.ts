import type { Request, Response, NextFunction } from "express";
import * as receiptService from "../services/receipt.service.js";
import { getUserId } from "../utils/authorization.js";

export const getReceipt = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await receiptService.getReceipt(getUserId(req), Number(req.params.id)));
    } catch (err) {
        next(err);
    }
}
