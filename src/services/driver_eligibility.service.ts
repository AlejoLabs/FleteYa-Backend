import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { documentsStatus } from "./driver_car_info.service.js";
import { t, type Params } from "../i18n/index.js";

// La app lo reconoce para mostrar "Tu cuenta está en revisión" en vez de un error genérico
export const DRIVER_NOT_APPROVED = "DRIVER_NOT_APPROVED";

// Código del motivo de cada documento vencido (el texto está en los idiomas: errors.DOC_EXPIRED_*)
const EXPIRED_KEY: Record<string, string> = {
    LICENSE: "DOC_EXPIRED_LICENSE",
    SOAT: "DOC_EXPIRED_SOAT",
    TECHNO: "DOC_EXPIRED_TECHNO",
    INSURANCE: "DOC_EXPIRED_INSURANCE",
    INSPECTION: "DOC_EXPIRED_INSPECTION",
};

// SOAT y técnico-mecánica son nombres de Colombia. En los demás países los mismos documentos se llaman
// "seguro obligatorio" y "revisión técnica" (docs.INSURANCE, docs.INSPECTION). Las columnas no cambian
const GENERIC_DOCS: Record<string, string> = { SOAT: "INSURANCE", TECHNO: "INSPECTION" };
export const docNameKey = (key: string, countryCode: string = "CO") =>
    countryCode === "CO" ? key : GENERIC_DOCS[key] ?? key;

type CarForEligibility = {
    approval_status: "PENDING" | "APPROVED" | "REJECTED";
    approval_note: string | null;
    license_expires_at: Date | null;
    soat_expires_at: Date | null;
    techno_expires_at: Date | null;
};

// Por qué un conductor todavía no puede recibir fletes, o null si puede: el admin debe haber aprobado su vehículo
// y sus documentos deben estar vigentes. Devuelve el código del motivo y sus datos; la app lo escribe en su idioma
export interface BlockReason { key: string; params?: Params }
export const blockReasonOf = (car: CarForEligibility | null, now = new Date(), countryCode = "CO"): BlockReason | null => {
    if (!car) return { key: "REGISTER_VEHICLE_FIRST" };
    if (car.approval_status === "PENDING") return { key: "DRIVER_IN_REVIEW" };
    if (car.approval_status === "REJECTED") {
        return car.approval_note ? { key: "DRIVER_REJECTED_NOTE", params: { note: car.approval_note } } : { key: "DRIVER_REJECTED" };
    }
    const expired = documentsStatus(car, now).find((doc) => doc.status === "EXPIRED");
    if (expired) return { key: EXPIRED_KEY[docNameKey(expired.key, countryCode)] ?? "DOC_EXPIRED_GENERIC" };
    return null;
}

// El mismo motivo en español, para el panel y para saber rápido si puede trabajar (null = puede)
export const driverBlockReason = (car: CarForEligibility | null, now = new Date()): string | null => {
    const reason = blockReasonOf(car, now);
    return reason ? t("es", `errors.${reason.key}`, reason.params) : null;
}

export const ELIGIBILITY_SELECT = {
    approval_status: true, approval_note: true, license_expires_at: true, soat_expires_at: true, techno_expires_at: true,
} as const;

// Se llama antes de ponerse disponible, ver solicitudes u ofertar
export const assertDriverCanWork = async (idDriver: number) => {
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { ...ELIGIBILITY_SELECT, driver: { select: { country_code: true } } } });
    const reason = blockReasonOf(car, new Date(), car?.driver.country_code);
    if (reason) {
        throw new AppError(reason.key, 403, DRIVER_NOT_APPROVED, reason.params);
    }
}
