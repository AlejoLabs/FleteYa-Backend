import prisma from "../database/prismaClient.js";
import type { CreateDriverCarInfoInput, UpdateDocumentsInput, UpdateVehicleInput } from "../validators/driver_car_info.validator.js";
import { checkLicense, isHeavyLicense } from "../utils/licenseRules.js";
import { checkPlate, getCountry } from "./countries.service.js";
import { AppError } from "../utils/App.Error.js";
import { blockReasonOf, driverBlockReason } from "./driver_eligibility.service.js";
import { setDriverCanWork } from "../sockets/socketHandler.js";

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
        throw new AppError("VEHICLE_INFO_NOT_FOUND", 404);
    }
    if (viewerId === idDriver) {
        // Qué le falta para recibir fletes (en revisión, rechazado o un documento vencido); null si puede trabajar
        return { ...car, block_reason: driverBlockReason(car), block_reason_detail: blockReasonOf(car) };
    }
    const { id_driver, brand, color, plate, vehicle_type, model_year, is_covered, capacity_kg, capacity_m3, approval_status } = car;
    return { id_driver, brand, color, plate, vehicle_type, model_year, is_covered, capacity_kg, capacity_m3, approval_status };
};

const findMyCar = async (idDriver: number) => {
    const found = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, include: { driver: { select: { country_code: true } } } });
    if (!found) {
        throw new AppError("REGISTER_VEHICLE_FIRST", 404);
    }
    const { driver, ...car } = found;
    // La placa y la licencia siguen las reglas del país del conductor
    return { car, country: await getCountry(driver.country_code) };
}

// Otro vehículo (tipo o placa distintos) o datos corregidos después de un rechazo: el admin lo vuelve a revisar
const needsReview = (car: { approval_status: string; vehicle_type: string; plate: string }, data: { vehicle_type: string; plate: string }) =>
    car.approval_status === "REJECTED" || car.vehicle_type !== data.vehicle_type || car.plate !== data.plate;

// El conductor cambia de vehículo o corrige sus datos. Un camión pide licencia B2 o C2 en adelante
export const updateMyVehicle = async (idDriver: number, data: UpdateVehicleInput) => {
    const { car, country } = await findMyCar(idDriver);
    checkPlate(data.plate, country);
    if (data.vehicle_type === "CAMION" && !isHeavyLicense(country.code, car.license_category)) {
        throw new AppError("TRUCK_NEEDS_LICENSE_UPDATE", 409);
    }
    const review = needsReview(car, data);
    const updated = await prisma.driverCarInfo.update({
        where: { id_driver: idDriver },
        data: {
            ...(review ? { approval_status: "PENDING" as const, approval_note: null, reviewed_at: null } : {}),
            vehicle_type: data.vehicle_type,
            brand: data.brand,
            color: data.color,
            plate: data.plate,
            model_year: data.model_year,
            is_covered: data.is_covered,
            capacity_kg: data.capacity_kg ?? null,
            capacity_m3: data.capacity_m3 ?? null,
        }
    });
    // Mientras lo revisan deja de estar disponible
    if (review) await prisma.$executeRaw`DELETE FROM drivers_position WHERE id_driver = ${idDriver}`;
    await setDriverCanWork(idDriver, driverBlockReason(updated) === null);
    return { ...updated, block_reason: driverBlockReason(updated), block_reason_detail: blockReasonOf(updated) };
}

// Renovó la licencia, el SOAT o la técnico-mecánica. El aviso de vencimiento vuelve a contar desde cero
export const updateMyDocuments = async (idDriver: number, data: UpdateDocumentsInput) => {
    const { car, country } = await findMyCar(idDriver);
    checkLicense(country.code, data.license_category, car.vehicle_type);
    const updated = await prisma.driverCarInfo.update({
        where: { id_driver: idDriver },
        data: {
            license_category: data.license_category,
            license_expires_at: data.license_expires_at,
            soat_expires_at: data.soat_expires_at,
            techno_expires_at: data.techno_expires_at ?? null,
            documents_reminded_at: null,
            // Si lo habían rechazado (por ejemplo, por un documento), al corregir vuelve a revisión
            ...(car.approval_status === "REJECTED" ? { approval_status: "PENDING" as const, approval_note: null, reviewed_at: null } : {}),
        }
    });
    // Con los documentos renovados vuelve a aparecer en el mapa (si estaba aprobado)
    await setDriverCanWork(idDriver, driverBlockReason(updated) === null);
    return documentsStatus(updated);
}

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
        throw new AppError("REGISTER_VEHICLE_FIRST", 404);
    }
    return documentsStatus(car);
}
