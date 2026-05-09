
import prisma from "../database/prismaClient.js";
import type { CreateDriverCarInfoInput } from "../validators/driver_car_info.validator.js";

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

