import prisma from "../../database/prismaClient.js";
import type { UpdateRatesInput } from "../../validators/admin.validator.js";
import { logAdminAction } from "./admin_audit.service.js";

// Tarifas del precio sugerido y porcentaje de comisión, sin entrar a la base de datos.
// Los viajes ya acordados no cambian: cada uno guardó su comisión al asignarse

const VEHICLE_ORDER = ["CARRY", "ESTACAS", "FURGON", "CAMION"];

export const getRates = async () => {
    const [values, vehicles] = await Promise.all([
        prisma.timeAndDistanceValues.findUniqueOrThrow({ where: { id: 1 } }),
        prisma.vehicleRate.findMany(),
    ]);
    const { id, ...fares } = values;
    return {
        ...fares,
        vehicle_rates: vehicles.sort((a, b) => VEHICLE_ORDER.indexOf(a.vehicle_type) - VEHICLE_ORDER.indexOf(b.vehicle_type)),
    };
}

// Solo lo que cambió queda en el registro, con el valor anterior y el nuevo
const describeChanges = (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys(after)
        .filter((key) => before[key] !== after[key])
        .map((key) => `${key}: ${before[key]} → ${after[key]}`);

export const updateRates = async (adminId: number, data: UpdateRatesInput) => {
    const before = await getRates();
    const { vehicle_rates, ...fares } = data;

    const changes = describeChanges(before, fares);
    for (const rate of vehicle_rates) {
        const old = before.vehicle_rates.find((row) => row.vehicle_type === rate.vehicle_type);
        changes.push(...describeChanges(old ?? {}, rate).map((change) => `${rate.vehicle_type}.${change}`)
            .filter((change) => !change.includes("vehicle_type")));
    }

    await prisma.$transaction(async (tx) => {
        await tx.timeAndDistanceValues.update({ where: { id: 1 }, data: fares });
        for (const rate of vehicle_rates) {
            await tx.vehicleRate.upsert({
                where: { vehicle_type: rate.vehicle_type },
                update: { base_fare: rate.base_fare, km_factor: rate.km_factor },
                create: rate,
            });
        }
        if (changes.length) await logAdminAction(tx, adminId, "UPDATE_RATES", "config", 1, changes.join(" · "));
    });
    return getRates();
}
