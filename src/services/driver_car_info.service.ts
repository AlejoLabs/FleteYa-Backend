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

// El dueño ve todo; los demás (el cliente que compara ofertas) solo el vehículo, sin números de licencia ni de tarjeta de propiedad
export const getByDriver = async (idDriver: number, viewerId: number) => {
    const car = await prisma.driverCarInfo.findUnique({
        where: {
            id_driver: idDriver
        }
    });

    if (!car) {
        throw new AppError("La informacion del vehiculo no existe", 404);
    }
    if (viewerId === idDriver) {
        return car;
    }
    const { id_driver, brand, color, plate, vehicle_type, model_year, is_covered, approval_status } = car;
    return { id_driver, brand, color, plate, vehicle_type, model_year, is_covered, approval_status };
};

// Se avisa desde 30 días antes del vencimiento
export const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type DocumentDates = { license_expires_at: Date | null; soat_expires_at: Date | null; techno_expires_at: Date | null };

// Estado de cada documento: vigente, por vencer o vencido. La técnico-mecánica puede faltar en vehículos nuevos
export const documentsStatus = (car: DocumentDates, now = new Date()) => {
    const documents = [
        { key: "LICENSE", label: "Licencia de conducción", expires_at: car.license_expires_at },
        { key: "SOAT", label: "SOAT", expires_at: car.soat_expires_at },
        { key: "TECHNO", label: "Revisión técnico-mecánica", expires_at: car.techno_expires_at },
    ];
    return documents
        .filter((doc) => doc.expires_at !== null)
        .map((doc) => {
            const daysLeft = Math.ceil((doc.expires_at!.getTime() - now.getTime()) / DAY_MS);
            const status = daysLeft < 0 ? "EXPIRED" : daysLeft <= EXPIRING_SOON_DAYS ? "EXPIRING" : "OK";
            return { ...doc, days_left: daysLeft, status };
        });
}

export const getMyDocuments = async (idDriver: number) => {
    const car = await prisma.driverCarInfo.findUnique({
        where: { id_driver: idDriver },
        select: { license_expires_at: true, soat_expires_at: true, techno_expires_at: true }
    });
    if (!car) {
        throw new AppError("Primero registra tu vehículo", 404);
    }
    return documentsStatus(car);
}
