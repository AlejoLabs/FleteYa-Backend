import prisma from "../database/prismaClient.js";
import type { CreateDriverCarInfoInput } from "../validators/driver_car_info.validator.js";
import { AppError } from "../utils/App.Error.js";

export const createDriverCarInfo = async (idDriver: number, data: CreateDriverCarInfoInput) => {
    const driverCarInfo = await prisma.driverCarInfo.upsert({
        where: {
            id_driver: idDriver
        },
        create: {
            id_driver: idDriver,
            brand: data.brand,
            color: data.color,
            plate: data.plate
        },
        update: {
            brand: data.brand,
            color: data.color,
            plate: data.plate
        }
    });

    return driverCarInfo;
};

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
};
