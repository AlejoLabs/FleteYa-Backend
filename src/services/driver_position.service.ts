import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import type { CreateDriverPositionInput } from "../validators/driver_position_validator.js";

export const createDriverPosition = async (data: CreateDriverPositionInput) => {
    const user = await prisma.user.findUnique({ where: { id: data.id_driver } });

    if (!user) {
        throw new AppError("Usuario no encontrado", 404);
    }

    const point = `POINT(${data.lng} ${data.lat})`;

    await prisma.$executeRawUnsafe(`
        REPLACE INTO drivers_position (id_driver, position)
        VALUES (?, ST_GeomFromText(?, 4326))
    `, 
    data.id_driver, 
    point
    );

    return data;
}