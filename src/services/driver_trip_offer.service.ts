import { id } from "zod/locales";
import prisma from "../database/prismaClient.js";
import type { CreateDriverTripOfferInput } from "../validators/driver_trip_offer.validator.js";
import { update } from "./users.service.js";

export const createDriverTripOffer = async (data: CreateDriverTripOfferInput) => {
    const driverTripOffer = await prisma.driverTripOffer.create({
        data: {
            id_driver: data.id_driver,
            id_client_request: data.id_client_request,
            fare_offered: data.fare_offered,
            time: data.time,
            distance: data.distance
        }
    });
    return driverTripOffer;
}

export const getByClientRequest = async (idClientRequest: number) => {
    const offers = await prisma.driverTripOffer.findMany({
        where: { id_client_request: idClientRequest },
        include: {
            driver: {}
        }
    });
    return offers.map((offer) => ({
        id: offer.id,
        id_driver: offer.id_driver,
        id_client_request: offer.id_client_request,
        fare_offered: offer.fare_offered,
        time: offer.time,
        distance: offer.distance,
        created_at: offer.created_at,
        updated_at: offer.update_at,
        driver: offer.driver ? {
            id: offer.driver.id,
            name: offer.driver.name,
            lastname: offer.driver.lastname,
            phone: offer.driver.phone,
            image: offer.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${offer.driver.image}` : null,
        } : null
    }));
}