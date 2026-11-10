import express from "express";
import { adminAuth } from "../middlewares/adminAuth.js";
import { validateBody } from "../middlewares/validateBody.js";
import { AppError } from "../utils/App.Error.js";
import {
    adminLoginSchema, cancelTripSchema, incidentStatusSchema, rejectDriverSchema, suspendUserSchema, updateRatesSchema,
} from "../validators/admin.validator.js";
import * as admin from "../controllers/admin.controller.js";

// API del panel de administración (/admin/api). Todo, salvo entrar y salir, pide la sesión del panel con rol ADMIN
const router = express.Router();

const positiveInt = (req: express.Request, res: express.Response, next: express.NextFunction, value: string) =>
    Number.isInteger(Number(value)) && Number(value) > 0 ? next() : next(new AppError("Id no válido", 400));
router.param("id", positiveInt);
router.param("photoId", positiveInt);

router.post("/login", validateBody(adminLoginSchema), admin.login);
router.post("/logout", admin.logout);

router.use(adminAuth);

router.get("/me", admin.me);
router.get("/stats", admin.getStats);

router.get("/users", admin.listUsers);
router.get("/users/:id", admin.getUser);
router.put("/users/:id/suspend", validateBody(suspendUserSchema), admin.suspendUser);
router.put("/users/:id/reactivate", admin.reactivateUser);
router.post("/users/:id/anonymize", admin.anonymizeUser);

router.get("/drivers", admin.listDrivers);
router.get("/drivers/:id", admin.getDriver);
router.get("/drivers/:id/photos/:photoId", admin.getDriverPhoto);
router.put("/drivers/:id/approve", admin.approveDriver);
router.put("/drivers/:id/reject", validateBody(rejectDriverSchema), admin.rejectDriver);

router.get("/trips", admin.listTrips);
router.get("/trips/:id", admin.getTrip);
router.put("/trips/:id/cancel", validateBody(cancelTripSchema), admin.cancelTrip);

router.get("/payments", admin.listPayments);
router.get("/commissions", admin.listCommissions);
router.post("/commissions/:id/settle", admin.settleCommission);

router.get("/incidents", admin.listIncidents);
router.get("/incidents/:id", admin.getIncident);
router.get("/incidents/:id/photos/:photoId", admin.getIncidentPhoto);
router.put("/incidents/:id", validateBody(incidentStatusSchema), admin.updateIncident);

router.get("/config", admin.getRates);
router.put("/config", validateBody(updateRatesSchema), admin.updateRates);
router.delete("/config", admin.resetRates);

router.get("/audit", admin.listAudit);

export default router;
