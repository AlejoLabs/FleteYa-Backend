import type { Request, Response, NextFunction } from "express";
import { ADMIN_SESSION_HOURS } from "../config/jwt.js";
import { ADMIN_COOKIE, getAdminId } from "../middlewares/adminAuth.js";
import { oneOf, pageOf, searchText } from "../validators/admin.validator.js";
import * as auth from "../services/admin/admin_auth.service.js";
import * as audit from "../services/admin/admin_audit.service.js";
import * as stats from "../services/admin/admin_stats.service.js";
import * as users from "../services/admin/admin_users.service.js";
import * as drivers from "../services/admin/admin_drivers.service.js";
import * as trips from "../services/admin/admin_trips.service.js";
import * as payments from "../services/admin/admin_payments.service.js";
import * as incidents from "../services/admin/admin_incidents.service.js";
import * as config from "../services/admin/admin_config.service.js";

// Controladores del panel: leen la petición, llaman al servicio y responden JSON (o el archivo de una foto)

const json = (handler: (req: Request) => Promise<unknown>, status = 200) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            return res.status(status).json(await handler(req));
        } catch (err) {
            next(err);
        }
    };

const file = (handler: (req: Request) => Promise<string>) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const filePath = await handler(req);
            res.setHeader("Cache-Control", "private, max-age=3600");
            return res.sendFile(filePath);
        } catch (err) {
            next(err);
        }
    };

const id = (req: Request, name = "id") => Number(req.params[name]);

const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { token, admin } = await auth.adminLogin(req.body.email, req.body.password);
        res.cookie(ADMIN_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: ADMIN_SESSION_HOURS * 60 * 60 * 1000 });
        return res.status(200).json(admin);
    } catch (err) {
        next(err);
    }
}

export const logout = (req: Request, res: Response) => {
    res.clearCookie(ADMIN_COOKIE, COOKIE_OPTIONS);
    return res.status(200).json({ ok: true });
}

export const me = json((req) => auth.getAdminProfile(getAdminId(req)));
export const getStats = json((req) => stats.getStats(oneOf(String(req.query.days), ["7", "30", "90"] as const) ? Number(req.query.days) : 30));

export const listUsers = json((req) => users.listUsers({
    q: searchText(req.query.q), page: pageOf(req.query.page),
    role: oneOf(req.query.role, ["CLIENT", "DRIVER", "ADMIN"] as const),
    status: oneOf(req.query.status, ["ACTIVE", "SUSPENDED"] as const),
}));
export const getUser = json((req) => users.getUserDetail(id(req)));
export const suspendUser = json((req) => users.suspendUser(getAdminId(req), id(req), req.body.reason));
export const reactivateUser = json((req) => users.reactivateUser(getAdminId(req), id(req)));
export const anonymizeUser = json((req) => users.anonymizeUser(getAdminId(req), id(req)));

export const listDrivers = json((req) => drivers.listDrivers(oneOf(req.query.approval, ["PENDING", "APPROVED", "REJECTED"] as const)));
export const getDriver = json((req) => drivers.getDriverReview(id(req)));
export const getDriverPhoto = file((req) => drivers.getDriverPhotoFile(id(req), id(req, "photoId")));
export const approveDriver = json((req) => drivers.approveDriver(getAdminId(req), id(req)));
export const rejectDriver = json((req) => drivers.rejectDriver(getAdminId(req), id(req), req.body.note));

const TRIP_STATUSES = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING", "FINISHED", "CANCELED", "EXPIRED"] as const;
export const listTrips = json((req) => trips.listTrips({
    status: oneOf(req.query.status, TRIP_STATUSES), stuck: req.query.stuck === "1",
    q: searchText(req.query.q), page: pageOf(req.query.page),
}));
export const getTrip = json((req) => trips.getTripDetail(id(req)));
export const cancelTrip = json((req) => trips.cancelTrip(getAdminId(req), id(req), req.body.reason));

export const listPayments = json((req) => payments.listPayments(pageOf(req.query.page)));
export const listCommissions = json(() => payments.listCashCommissions());
export const settleCommission = json((req) => payments.settleCashCommission(getAdminId(req), id(req), typeof req.query.currency === "string" && /^[A-Z]{3}$/.test(req.query.currency) ? req.query.currency : undefined));

export const listIncidents = json((req) => incidents.listIncidents(oneOf(req.query.status, ["OPEN", "IN_REVIEW", "RESOLVED"] as const)));
export const getIncident = json((req) => incidents.getIncident(id(req)));
export const getIncidentPhoto = file((req) => incidents.getIncidentPhotoFile(id(req), id(req, "photoId")));
export const updateIncident = json((req) => incidents.updateIncidentStatus(getAdminId(req), id(req), req.body.status));

export const getRates = json((req) => config.getRates(typeof req.query.country === "string" ? req.query.country.toUpperCase() : undefined));
export const updateRates = json((req) => config.updateRates(getAdminId(req), req.body));
export const resetRates = json((req) => config.resetRates(getAdminId(req), String(req.query.country ?? "").toUpperCase()));

export const listAudit = json((req) => audit.listAdminActions(pageOf(req.query.page)));
