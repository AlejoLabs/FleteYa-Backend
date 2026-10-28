import prisma from "../database/prismaClient.js";
import type { CreateDriverTripOfferInput } from "../validators/driver_trip_offer.validator.js";
import { AppError } from "../utils/App.Error.js";

export const createDriverTripOffer = async (idDriver: number, data: CreateDriverTripOfferInput) => {
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id_client_request },
        select: { id_client: true, status: true }
    });
    if (!clientRequest) {
        throw new AppError("La solicitud de viaje no existe", 404);
    }
    if (clientRequest.status !== "CREATED") {
        throw new AppError("Este viaje ya no recibe ofertas", 409);
    }
    if (clientRequest.id_client === idDriver) {
        throw new AppError("No puedes ofertar en tu propio viaje", 400);
    }

    const driverTripOffer = await prisma.driverTripOffer.create({
        data: {
            id_driver: idDriver,
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
            driver: {
                include: {
                    driverCarInfo: true
                }
            }
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
        } : null,
        car: offer.driver.driverCarInfo ? {
            id: offer.driver.id,
            brand: offer.driver.driverCarInfo.brand,
            color: offer.driver.driverCarInfo.color,
            plate: offer.driver.driverCarInfo.plate

        } : null
    }));
}