import type { Request, Response, NextFunction } from "express";
import * as clientRequestService from "../services/client_request.service.js";
import * as clientRequestTripService from "../services/client_request_trip.service.js";
import * as clientRequestQueriesService from "../services/client_request_queries.service.js";
import { assertTripParticipant } from "../services/client_request.shared.js";
import { AppError } from "../utils/App.Error.js";
import { getUserId } from "../utils/authorization.js";
import { VEHICLE_ORDER } from "../utils/vehicles.js";
import { getUserLanguage } from "../services/users.service.js";
import type { VehicleType } from "../generated/prisma/enums.js";


export const createClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // El dueño del viaje es quien hace la petición, no el id_client que venga en el cuerpo
        const body = { ...req.body, id_client: getUserId(req) };
        const data = await clientRequestService.createClientRequest(body);
        return res.status(201).json(data);
    } catch (err) {
        next(err);
    }

}

export const assignDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await clientRequestTripService.assignDriver(getUserId(req), req.body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}

export const updateClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await clientRequestTripService.updateStatus(getUserId(req), req.body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}

export const updateClientRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestTripService.updateClientRating(getUserId(req), req.body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const updateDriverRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestTripService.updateDriverRating(getUserId(req), req.body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getNearbyClientRequests = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const driverLat = Number(req.params.driver_lat);
        const driverLng = Number(req.params.driver_lng);
        const result = await clientRequestQueriesService.getNearbyClientRequests(getUserId(req), driverLat, driverLng);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }

}

export const raiseFare = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestService.raiseFare(getUserId(req), Number(req.params.id), req.body);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const cancelClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestTripService.cancelClientRequest(getUserId(req), Number(req.params.id), req.body);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const dismissClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestService.dismissClientRequest(getUserId(req), Number(req.params.id));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const getMyActiveTrips = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestQueriesService.getMyActiveTrips(getUserId(req));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const getByClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        await assertTripParticipant(id, getUserId(req));
        const result = await clientRequestQueriesService.getByClientRequest(id, getUserId(req));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }

}

export const getByClientAssigned = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_client = Number(req.params.id_client);
        const result = await clientRequestQueriesService.getByClientAssigned(id_client);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getByDriverAssigned = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_driver_assigned = Number(req.params.id_driver_assigned);
        const result = await clientRequestQueriesService.getByDriverAssigned(id_driver_assigned);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getTimeAndDistance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const originLat = Number(req.params.origin_lat);
        const originLng = Number(req.params.origin_lng);
        const destinationLat = Number(req.params.destination_lat);
        const destinationLng = Number(req.params.destination_lng);
        const weight = Number(req.query.weight);
        const size = Number(req.query.size);

        if (!Number.isFinite(weight) || weight <= 0) {
            throw new AppError("WEIGHT_REQUIRED", 400);
        }

        if (!Number.isFinite(size) || size <= 0) {
            throw new AppError("SIZE_REQUIRED", 400);
        }

        // Sin vehículo (versiones viejas de la app) se cotiza con el más pequeño
        const vehicle = (req.query.vehicle ?? "CARRY") as VehicleType;
        if (!VEHICLE_ORDER.includes(vehicle)) {
            throw new AppError("VEHICLE_TYPE_INVALID", 400);
        }

        const data = await clientRequestService.getTimeAndDistance(
            originLat,
            originLng,
            destinationLat,
            destinationLng,
            weight,
            size,
            vehicle,
            await getUserLanguage(getUserId(req))
        );
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}

export const deliverClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestTripService.deliverWithCode(getUserId(req), Number(req.params.id), req.body);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const confirmDelivery = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestTripService.confirmDelivery(getUserId(req), Number(req.params.id));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}
