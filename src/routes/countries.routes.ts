import express from "express";
import type { NextFunction, Request, Response } from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { AppError } from "../utils/App.Error.js";
import { detectCountry, listCountries, publicCountry } from "../services/countries.service.js";

// Países de FleteYa. La lista es pública: el registro la usa para el selector de indicativo antes de tener sesión
const router = express.Router();

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.status(200).json((await listCountries()).map(publicCountry));
    } catch (err) {
        next(err);
    }
});

// En qué país está un punto (el buscador de direcciones busca en ese país). Con sesión, para no regalar la consulta
router.get("/at/:lat/:lng", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const lat = Number(req.params.lat);
        const lng = Number(req.params.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw new AppError("LAT_INVALID", 400, undefined, { field: "@fields.lat" });
        }
        // supported false: FleteYa no opera en ese país. La app lo avisa y no deja pedir fletes desde ahí
        const { country, method } = await detectCountry(lat, lng);
        return res.status(200).json(country ? { supported: true, method, ...publicCountry(country) } : { supported: false, method });
    } catch (err) {
        next(err);
    }
});

export default router;
