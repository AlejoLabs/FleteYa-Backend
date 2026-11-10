import prisma from "../database/prismaClient.js";
import { sendPush } from "../utils/push.js";
import { t, type Language } from "../i18n/index.js";
import { documentsStatus, EXPIRING_SOON_DAYS } from "./driver_car_info.service.js";
import { docNameKey } from "./driver_eligibility.service.js";

// Recordatorios que corren solos desde server.ts

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// El aviso de documentos se repite como mucho una vez por semana
const DOCUMENTS_REMIND_EVERY_MS = 7 * DAY_MS;

// Una hora antes de un flete programado ya aceptado, se le recuerda al cliente y al conductor
export const sendScheduledReminders = async () => {
    const now = new Date();
    const upcoming = await prisma.clientRequests.findMany({
        where: {
            status: { in: ["ACCEPTED", "ON_THE_WAY"] },
            reminder_sent_at: null,
            scheduled_at: { gt: now, lte: new Date(now.getTime() + HOUR_MS) }
        },
        select: { id: true, id_client: true, id_driver_assigned: true, scheduled_at: true, pickup_description: true },
        take: 100
    });

    for (const trip of upcoming) {
        // updateMany con reminder_sent_at null: si dos procesos corren a la vez, solo uno lo envía
        const claimed = await prisma.clientRequests.updateMany({
            where: { id: trip.id, reminder_sent_at: null },
            data: { reminder_sent_at: now }
        });
        if (claimed.count === 0) continue;

        const minutes = Math.max(1, Math.round((trip.scheduled_at!.getTime() - now.getTime()) / 60000));
        const params = { count: minutes, pickup: trip.pickup_description };
        void sendPush(trip.id_client, { type: "SCHEDULED_REMINDER", id_client_request: trip.id, key: "SCHEDULED_REMINDER_CLIENT", params });
        if (trip.id_driver_assigned) {
            void sendPush(trip.id_driver_assigned, { type: "SCHEDULED_REMINDER", id_client_request: trip.id, key: "SCHEDULED_REMINDER_DRIVER", params });
        }
    }
}

// "SOAT vence en 5 días" / "SOAT está vencido", con el nombre del documento en el idioma de quien lo recibe
// y el de su país (fuera de Colombia, "Seguro obligatorio")
const describe = (language: Language, doc: { key: string; days_left: number; status: string }, countryCode: string) => {
    const label = t(language, `docs.${docNameKey(doc.key, countryCode)}`);
    return doc.status === "EXPIRED"
        ? t(language, "push.DOCUMENTS_EXPIRING.expired", { label })
        : t(language, "push.DOCUMENTS_EXPIRING.expiresIn", { label, count: doc.days_left });
}

// Conductores con algún documento vencido o que vence en los próximos 30 días
export const remindExpiringDocuments = async () => {
    const now = new Date();
    const limit = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);
    const cars = await prisma.driverCarInfo.findMany({
        where: {
            OR: [
                { license_expires_at: { lte: limit } },
                { soat_expires_at: { lte: limit } },
                { techno_expires_at: { lte: limit } },
            ],
            AND: [{ OR: [{ documents_reminded_at: null }, { documents_reminded_at: { lt: new Date(now.getTime() - DOCUMENTS_REMIND_EVERY_MS) } }] }]
        },
        select: { id_driver: true, license_expires_at: true, soat_expires_at: true, techno_expires_at: true, driver: { select: { country_code: true } } },
        take: 200
    });

    for (const car of cars) {
        const pending = documentsStatus(car, now).filter((doc) => doc.status !== "OK");
        if (!pending.length) continue;
        await prisma.driverCarInfo.update({ where: { id_driver: car.id_driver }, data: { documents_reminded_at: now } });
        void sendPush(car.id_driver, (language) => ({
            type: "DOCUMENTS_EXPIRING",
            key: pending.some((doc) => doc.status === "EXPIRED") ? "DOCUMENTS_EXPIRED" : "DOCUMENTS_EXPIRING",
            params: { list: pending.map((doc) => describe(language, doc, car.driver.country_code)).join(". ") },
        }));
    }
    if (cars.length) console.log(`[recordatorios] documentos revisados de ${cars.length} conductores`);
}
