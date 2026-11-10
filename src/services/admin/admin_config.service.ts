import prisma from "../../database/prismaClient.js";
import type { UpdateRatesInput } from "../../validators/admin.validator.js";
import { DEFAULT_COUNTRY, getCountry, listCountries, ratesFor } from "../countries.service.js";
import { logAdminAction } from "./admin_audit.service.js";

// Tarifas del precio sugerido y porcentaje de comisión de cada país, en su moneda, sin entrar a la base de datos.
// Cada país usa las tarifas base de su moneda hasta que el admin le pone las suyas; puede volver a las de la moneda.
// Los viajes ya acordados no cambian: cada uno guardó su comisión al asignarse

const VEHICLE_ORDER = ["CARRY", "ESTACAS", "FURGON", "CAMION"];

// Sin país (la pantalla de antes de la Fase 9b) se usa Colombia
export const getRates = async (countryCode: string = DEFAULT_COUNTRY) => {
    const country = await getCountry(countryCode);
    const [rates, countries] = await Promise.all([ratesFor(country), listCountries()]);
    return {
        country_code: country.code,
        currency: country.currency.code,
        ...rates,
        vehicle_rates: rates.vehicle_rates.sort((a, b) => VEHICLE_ORDER.indexOf(a.vehicle_type) - VEHICLE_ORDER.indexOf(b.vehicle_type)),
        // Para el selector de país del panel
        countries: countries.map((item) => ({ code: item.code, name: item.names.es ?? item.code, currency: item.currency.code })),
    };
}

// Solo lo que cambió queda en el registro, con el valor anterior y el nuevo
const describeChanges = (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys(after)
        .filter((key) => before[key] !== after[key])
        .map((key) => `${key}: ${before[key]} → ${after[key]}`);

// Guarda las tarifas propias del país (desde ese momento ya no sigue a las de su moneda)
export const updateRates = async (adminId: number, data: UpdateRatesInput) => {
    const { vehicle_rates, country_code = DEFAULT_COUNTRY, ...fares } = data;
    const before = await getRates(country_code);

    const changes = describeChanges(before, fares);
    for (const rate of vehicle_rates) {
        const old = before.vehicle_rates.find((row) => row.vehicle_type === rate.vehicle_type);
        changes.push(...describeChanges(old ?? {}, rate).map((change) => `${rate.vehicle_type}.${change}`)
            .filter((change) => !change.includes("vehicle_type")));
    }
    if (!changes.length) return before;

    const code = before.country_code;
    await prisma.$transaction(async (tx) => {
        await tx.countryRate.upsert({ where: { country_code: code }, update: fares, create: { country_code: code, ...fares } });
        // Los cuatro vehículos quedan propios del país, también los que no cambiaron
        for (const rate of before.vehicle_rates) {
            const next = vehicle_rates.find((item) => item.vehicle_type === rate.vehicle_type) ?? rate;
            await tx.countryVehicleRate.upsert({
                where: { country_code_vehicle_type: { country_code: code, vehicle_type: rate.vehicle_type } },
                update: { base_fare: next.base_fare, km_factor: next.km_factor },
                create: { country_code: code, vehicle_type: rate.vehicle_type, base_fare: next.base_fare, km_factor: next.km_factor },
            });
        }
        // El registro dice de qué país (y moneda) son los valores
        await logAdminAction(tx, adminId, "UPDATE_RATES", "config", null, `${code} (${before.currency}) · ${changes.join(" · ")}`);
    });
    return getRates(code);
}

// Vuelve a las tarifas base de su moneda: se borran las propias del país
export const resetRates = async (adminId: number, countryCode: string) => {
    const country = await getCountry(countryCode);
    await prisma.$transaction(async (tx) => {
        const own = await tx.countryRate.deleteMany({ where: { country_code: country.code } });
        const vehicles = await tx.countryVehicleRate.deleteMany({ where: { country_code: country.code } });
        if (own.count || vehicles.count) {
            await logAdminAction(tx, adminId, "RESET_RATES", "config", null, `${country.code} vuelve a las tarifas de ${country.currency.code}`);
        }
    });
    return getRates(country.code);
}
