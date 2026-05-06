import prisma from "../database/prismaClient.js";
import type { CreateDriverTripOfferInput } from "../validators/driver_trip_offer.validator.js";

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