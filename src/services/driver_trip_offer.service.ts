import prisma from "../database/prismaClient.js";
import { driverRatings, ratingOf } from "./ratings.service.js";
import type { CreateDriverTripOfferInput } from "../validators/driver_trip_offer.validator.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import { canCarry } from "../utils/vehicles.js";
import { notifyUser } from "../sockets/socketHandler.js";
import { formatPesos, sendPush } from "../utils/push.js";
import { assertDriverCanWork } from "./driver_eligibility.service.js";

// Ofertar o contraofertar: si el conductor ya tenía una oferta pendiente, la nueva la reemplaza
export const createDriverTripOffer = async (idDriver: number, data: CreateDriverTripOfferInput) => {
    await assertDriverCanWork(idDriver);
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id_client_request },
        select: { id_client: true, status: true, expires_at: true, required_vehicle: true, weight_kg: true, length_cm: true, width_cm: true, height_cm: true, packages: true }
    });
    if (!clientRequest) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    if (clientRequest.status !== "CREATED" || !clientRequest.expires_at || clientRequest.expires_at <= new Date()) {
        throw new AppError("TRIP_NOT_ACCEPTING_OFFERS", 409);
    }
    if (clientRequest.id_client === idDriver) {
        throw new AppError("CANNOT_OFFER_OWN_TRIP", 400);
    }

    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { vehicle_type: true, capacity_kg: true, capacity_m3: true } });
    const cargo = {
        weight_kg: clientRequest.weight_kg ?? undefined, length_cm: clientRequest.length_cm ?? undefined, width_cm: clientRequest.width_cm ?? undefined,
        height_cm: clientRequest.height_cm ?? undefined, packages: clientRequest.packages, required_vehicle: clientRequest.required_vehicle,
    };
    if (!canCarry(car ?? { vehicle_type: "CARRY", capacity_kg: null, capacity_m3: null }, cargo)) {
        throw new AppError("CARGO_DOES_NOT_FIT", 409);
    }

    const dismissed = await prisma.driverDismissedRequest.findUnique({
        where: { id_driver_id_client_request: { id_driver: idDriver, id_client_request: data.id_client_request } }
    });
    if (dismissed) {
        throw new AppError("REQUEST_DISMISSED", 409);
    }

    const offer = await prisma.$transaction(async (tx) => {
        await tx.driverTripOffer.updateMany({
            where: { id_client_request: data.id_client_request, id_driver: idDriver, status: "PENDING" },
            data: { status: "WITHDRAWN" }
        });
        return tx.driverTripOffer.create({
            data: {
                id_driver: idDriver,
                id_client_request: data.id_client_request,
                fare_offered: data.fare_offered,
                time: data.time,
                distance: data.distance
            }
        });
    });

    // Con la app abierta la oferta llega por socket; la push es para cuando el cliente salió de la app mientras espera
    void sendPush(clientRequest.id_client, {
        type: "NEW_OFFER", id_client_request: data.id_client_request, key: "NEW_OFFER",
        params: { amount: formatPesos(data.fare_offered), count: Math.round(data.time) },
    });
    return offer;
}

const findOfferOrFail = async (id: number) => {
    const offer = await prisma.driverTripOffer.findUnique({
        where: { id },
        select: { id: true, id_driver: true, id_client_request: true, status: true, client_request: { select: { id_client: true } } }
    });
    if (!offer) {
        throw new AppError("OFFER_NOT_FOUND", 404);
    }
    return offer;
}

// El cliente rechaza una oferta: al conductor le llega el aviso y puede volver a ofertar con otro precio
export const rejectOffer = async (userId: number, id: number) => {
    const offer = await findOfferOrFail(id);
    if (offer.client_request.id_client !== userId) {
        throw deny(userId, "rechazar-oferta", `driver_trip_offers/${id}`);
    }
    const result = await prisma.driverTripOffer.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "REJECTED" }
    });
    if (result.count === 0) {
        throw new AppError("OFFER_NOT_VALID", 409);
    }
    notifyUser(offer.id_driver, `offer_status/${offer.id_driver}`, {
        id_client_request: offer.id_client_request, status: "REJECTED", reason: "CLIENT_REJECTED"
    });
    return { id, status: "REJECTED" };
}

// El conductor retira su oferta antes de que el cliente la acepte
export const withdrawOffer = async (userId: number, id: number) => {
    const offer = await findOfferOrFail(id);
    if (offer.id_driver !== userId) {
        throw deny(userId, "retirar-oferta", `driver_trip_offers/${id}`);
    }
    const result = await prisma.driverTripOffer.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "WITHDRAWN" }
    });
    if (result.count === 0) {
        throw new AppError("OFFER_NOT_VALID", 409);
    }
    notifyUser(offer.client_request.id_client, `created_driver_offer/${offer.id_client_request}`, {
        id_client_request: offer.id_client_request
    });
    return { id, status: "WITHDRAWN" };
}

// El cliente solo ve las ofertas vigentes: las rechazadas, retiradas o vencidas ya no se pueden aceptar
export const getByClientRequest = async (idClientRequest: number) => {
    const offers = await prisma.driverTripOffer.findMany({
        where: { id_client_request: idClientRequest, status: "PENDING" },
        orderBy: { fare_offered: "asc" },
        include: {
            driver: {
                include: {
                    driverCarInfo: true
                }
            }
        }
    });
    const ratings = await driverRatings(offers.map((offer) => offer.id_driver));
    return offers.map((offer) => ({
        id: offer.id,
        id_driver: offer.id_driver,
        id_client_request: offer.id_client_request,
        fare_offered: offer.fare_offered,
        time: offer.time,
        distance: offer.distance,
        status: offer.status,
        created_at: offer.created_at,
        updated_at: offer.update_at,
        driver: offer.driver ? {
            id: offer.driver.id,
            name: offer.driver.name,
            lastname: offer.driver.lastname,
            rating: ratingOf(ratings, offer.id_driver),
            image: offer.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${offer.driver.image}` : null,
        } : null,
        car: offer.driver.driverCarInfo ? {
            id: offer.driver.id,
            brand: offer.driver.driverCarInfo.brand,
            color: offer.driver.driverCarInfo.color,
            plate: offer.driver.driverCarInfo.plate,
            vehicle_type: offer.driver.driverCarInfo.vehicle_type

        } : null
    }));
}
