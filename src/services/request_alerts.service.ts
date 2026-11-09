import prisma from "../database/prismaClient.js";
import { canCarry } from "../utils/vehicles.js";
import { formatPesos, sendPush } from "../utils/push.js";
import { LOCALE_TAGS, t } from "../i18n/index.js";
import { driverBlockReason, ELIGIBILITY_SELECT } from "./driver_eligibility.service.js";

// Aviso push de una solicitud nueva a los conductores disponibles cerca de la recogida en cuyo vehículo cabe la carga.
// Disponible = tiene posición guardada (al ponerse "No disponible" la app la borra). Con la app abierta, el inicio
// muestra su propia tarjeta y la app no muestra esta notificación

const ALERT_RADIUS_M = 10000;

// Nunca lanza: si falla, la solicitud ya quedó creada y los conductores la ven en su lista
export const alertNearbyDrivers = async (idClientRequest: number) => {
    try {
        const trip = await prisma.clientRequests.findUnique({
            where: { id: idClientRequest },
            select: {
                id_client: true, fare_offered: true, cargo_category: true, required_vehicle: true,
                weight_kg: true, length_cm: true, width_cm: true, height_cm: true, packages: true, scheduled_at: true,
            }
        });
        if (!trip) return;

        const drivers = await prisma.$queryRaw<{ id_driver: number; distance: number }[]>`
            SELECT DP.id_driver, ST_Distance_Sphere(DP.position, CR.pickup_position) AS distance
            FROM drivers_position AS DP
            INNER JOIN client_requests AS CR ON CR.id = ${idClientRequest}
            WHERE DP.id_driver <> CR.id_client
            HAVING distance < ${ALERT_RADIUS_M}
        `;
        if (!drivers.length) return;

        const cars = await prisma.driverCarInfo.findMany({
            where: { id_driver: { in: drivers.map((driver) => driver.id_driver) }, approval_status: "APPROVED", driver: { status: "ACTIVE" } },
            select: { id_driver: true, vehicle_type: true, capacity_kg: true, capacity_m3: true, ...ELIGIBILITY_SELECT },
        });
        const cargo = {
            weight_kg: trip.weight_kg ?? undefined, length_cm: trip.length_cm ?? undefined, width_cm: trip.width_cm ?? undefined,
            height_cm: trip.height_cm ?? undefined, packages: trip.packages, required_vehicle: trip.required_vehicle,
        };

        for (const car of cars) {
            // Aprobado pero con un documento vencido: no recibe avisos hasta renovarlo
            if (driverBlockReason(car) || !canCarry(car, cargo)) continue;
            const distance = drivers.find((driver) => driver.id_driver === car.id_driver)!.distance;
            const distanceKm = Number(distance) / 1000;
            void sendPush(car.id_driver, (language) => ({
                type: "NEW_REQUEST", id_client_request: idClientRequest, key: "NEW_REQUEST",
                params: { amount: formatPesos(trip.fare_offered), category: t(language, `cargoCategories.${trip.cargo_category}`), km: distanceKm.toLocaleString(LOCALE_TAGS[language], { minimumFractionDigits: 1, maximumFractionDigits: 1 }), when: trip.scheduled_at ? t(language, "push.NEW_REQUEST.scheduled") : "" },
            }));
        }
    } catch (err) {
        console.error(`[alertas] no se pudo avisar la solicitud ${idClientRequest}`, err);
    }
}
