import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { documentsStatus } from "./driver_car_info.service.js";

// La app lo reconoce para mostrar "Tu cuenta está en revisión" en vez de un error genérico
export const DRIVER_NOT_APPROVED = "DRIVER_NOT_APPROVED";

const EXPIRED_TEXT: Record<string, string> = {
    LICENSE: "Tu licencia de conducción está vencida",
    SOAT: "Tu SOAT está vencido",
    TECHNO: "Tu revisión técnico-mecánica está vencida",
};

type CarForEligibility = {
    approval_status: "PENDING" | "APPROVED" | "REJECTED";
    approval_note: string | null;
    license_expires_at: Date | null;
    soat_expires_at: Date | null;
    techno_expires_at: Date | null;
};

// Por qué un conductor todavía no puede recibir fletes, o null si puede: el admin debe haber aprobado su vehículo
// y sus documentos deben estar vigentes
export const driverBlockReason = (car: CarForEligibility | null, now = new Date()): string | null => {
    if (!car) return "Primero registra tu vehículo";
    if (car.approval_status === "PENDING") {
        return "Tu cuenta de conductor está en revisión. Te avisamos cuando la aprueben";
    }
    if (car.approval_status === "REJECTED") {
        const note = car.approval_note ? `: ${car.approval_note}` : "";
        return `No aprobamos tu vehículo${note}. Corrige los datos en Mi vehículo y lo revisamos de nuevo`;
    }
    const expired = documentsStatus(car, now).find((doc) => doc.status === "EXPIRED");
    if (expired) {
        return `${EXPIRED_TEXT[expired.key] ?? "Tienes un documento vencido"}. Actualízalo en Mi vehículo para seguir recibiendo fletes`;
    }
    return null;
}

export const ELIGIBILITY_SELECT = {
    approval_status: true, approval_note: true, license_expires_at: true, soat_expires_at: true, techno_expires_at: true,
} as const;

// Se llama antes de ponerse disponible, ver solicitudes u ofertar
export const assertDriverCanWork = async (idDriver: number) => {
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: ELIGIBILITY_SELECT });
    const reason = driverBlockReason(car);
    if (reason) {
        throw new AppError(reason, 403, DRIVER_NOT_APPROVED);
    }
}
