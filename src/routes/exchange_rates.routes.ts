import express from "express";
import type { NextFunction, Request, Response } from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { exchangeRates } from "../services/exchange/index.js";

// Tasas de cambio de referencia (base USD), para que la app muestre "≈ US$27" junto a un precio en otra moneda.
// Cada tasa dice su fuente y su fecha; stale = la fuente no respondió y es la última guardada
const router = express.Router();

router.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json(await exchangeRates.getRates());
    } catch (err) {
        next(err);
    }
});

export default router;
