
import { id } from "zod/locales";
import prisma from "../database/prismaClient.js";
import type { CreateDriverCarInfoInput } from "../validators/driver_car_info.validator.js";
import { AppError } from "../utils/App.Error.js";

export const createDriverCarInfo = async (data: CreateDriverCarInfoInput) => {
    const driverCarInfo = await prisma.driverCarInfo.create({
        data: {
            id_driver: data.id_driver,
            brand: data.brand,
            color: data.color,
            plate: data.plate
        }
    });
    return driverCarInfo;
}

export const getByDriver = async (idDriver: number) => {
    const car = await prisma.driverCarInfo.findUnique({
        where: {
            id_driver: idDriver
        }
    });

    if (!car) {
        throw new AppError("La informacion del vehiculo no existe", 404);
    }
    return car;
}

