import type { Request, Response, NextFunction } from "express";
import * as clientRequestService from "../services/client_request_service.js";
import { AppError } from "../utils/App.Error.js";
import { getUserId } from "../utils/authorization.js";


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
        const data = await clientRequestService.assignDriver(getUserId(req), req.body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}

export const updateClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await clientRequestService.updateStatus(getUserId(req), req.body);
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}

export const updateClientRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestService.updateClientRating(getUserId(req), req.body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const updateDriverRating = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await clientRequestService.updateDriverRating(getUserId(req), req.body);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getNearbyClientRequests = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const driverLat = Number(req.params.driver_lat);
        const driverLng = Number(req.params.driver_lng);
        const result = await clientRequestService.getNearbyClientRequests(getUserId(req), driverLat, driverLng);
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
        const result = await clientRequestService.cancelClientRequest(getUserId(req), Number(req.params.id), req.body);
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
        const result = await clientRequestService.getMyActiveTrips(getUserId(req));
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}

export const getByClientRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        await clientRequestService.assertTripParticipant(id, getUserId(req));
        const result = await clientRequestService.getByClientRequest(id);
        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }

}

export const getByClientAssigned = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_client = Number(req.params.id_client);
        const result = await clientRequestService.getByClientAssigned(id_client);
        return res.status(200).json(result);
    } catch(err) {
        next(err);
    }
}

export const getByDriverAssigned = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id_driver_assigned = Number(req.params.id_driver_assigned);
        const result = await clientRequestService.getByDriverAssigned(id_driver_assigned);
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
            throw new AppError("El peso (weight) es obligatorio y debe ser mayor a 0", 400);
        }

        if (!Number.isFinite(size) || size <= 0) {
            throw new AppError("El tamaño (size) es obligatorio y debe ser mayor a 0", 400);
        }

        const data = await clientRequestService.getTimeAndDistance(
            originLat,
            originLng,
            destinationLat,
            destinationLng,
            weight,
            size
        );
        return res.status(200).json(data);
    } catch (err) {
        next(err);
    }

}
