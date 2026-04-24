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

export const getDriverPosition = async (id_driver: number) => {
    const result = await prisma.$queryRaw<Array<{id_driver: number, position: string}>>`
        SELECT 
            id_driver, 
            ST_AsText(position) as position
        FROM 
            drivers_position
        WHERE 
            id_driver = ${id_driver}
    `;
    if(!result || result.length === 0) {
        throw new AppError("El conductor no existe", 404);
    }
    const row = result[0];

    const match = row?.position.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);

    if (!match) {
        throw new AppError("Error al obtener la posición del conductor", 500);
    }

    const lng = parseFloat(match[1]!);
    const lat = parseFloat(match[2]!);
    return { 
        id_driver: row?.id_driver,
        lat: lat,
        lng: lng,
        
    };
}