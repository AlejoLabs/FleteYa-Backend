import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { pointSql } from "../utils/geo.js";
import { formatMoney, roundMoney } from "../utils/money.js";

// Países y monedas (tablas countries y currencies). Cambian muy poco: se guardan en memoria unos minutos para no
// leerlos en cada petición, y el panel borra la copia cuando cambia algo

// Las cuentas creadas sin país (versiones de la app de antes de la Fase 9b) quedan en Colombia
export const DEFAULT_COUNTRY = "CO";
// Si la recogida no cae dentro de ningún país (en la costa, el contorno simplificado puede quedar a 1 o 2 km de la
// orilla), se toma el país más cercano hasta esta distancia. Más lejos es un país sin FleteYa: Ginebra, por ejemplo,
// queda a 3,7 km de Francia
const NEARBY_COUNTRY_M = 3000;
const CACHE_MS = 5 * 60 * 1000;

export interface CurrencyInfo {
    code: string;
    decimals: number;
    fare_step: number;
    min_fare: number;
    max_fare: number;
}

export interface CountryInfo {
    code: string;
    names: Record<string, string>;
    currency: CurrencyInfo;
    default_language: string;
    phone_prefix: string;
    phone_pattern: string;
    phone_example: string;
    plate_pattern: string | null;
}

let cache: { countries: Map<string, CountryInfo>; currencies: Map<string, CurrencyInfo>; loaded_at: number } | null = null;

const load = async () => {
    if (cache && Date.now() - cache.loaded_at < CACHE_MS) return cache;
    const [currencies, countries] = await Promise.all([
        prisma.currency.findMany(),
        prisma.country.findMany({ orderBy: { code: "asc" } }),
    ]);
    const currencyMap = new Map(currencies.map((currency) => [currency.code, currency]));
    cache = {
        currencies: currencyMap,
        countries: new Map(countries.map((country) => [country.code, {
            code: country.code,
            names: country.names as Record<string, string>,
            currency: currencyMap.get(country.currency_code)!,
            default_language: country.default_language,
            phone_prefix: country.phone_prefix,
            phone_pattern: country.phone_pattern,
            phone_example: country.phone_example,
            plate_pattern: country.plate_pattern,
        }])),
        loaded_at: Date.now(),
    };
    return cache;
}

export const invalidateCountries = () => { cache = null; }

export const listCountries = async () => [...(await load()).countries.values()];

export const getCountry = async (code: string) => {
    const country = (await load()).countries.get(code);
    if (!country) throw new AppError("COUNTRY_INVALID", 400);
    return country;
}

export const getCurrency = async (code: string) => {
    const currency = (await load()).currencies.get(code);
    if (!currency) throw new AppError("COUNTRY_INVALID", 400);
    return currency;
}

// País donde está un punto, según el área guardada de cada país. El teléfono no lo decide: el backend lo calcula
// con las coordenadas. null = un país donde FleteYa no opera. method dice cómo se encontró (registros y pruebas)
export const detectCountry = async (lat: number, lng: number) => {
    const point = pointSql(lng, lat);
    const inside = await prisma.$queryRaw<{ code: string }[]>`
        SELECT code FROM countries WHERE ST_Contains(area, ${point}) LIMIT 1`;
    if (inside[0]) return { country: await getCountry(inside[0].code), method: "inside" as const };
    const nearest = await prisma.$queryRaw<{ code: string; distance: number }[]>`
        SELECT code, ST_Distance(area, ${point}) AS distance FROM countries ORDER BY distance LIMIT 1`;
    if (nearest[0] && Number(nearest[0].distance) <= NEARBY_COUNTRY_M) {
        return { country: await getCountry(nearest[0].code), method: "nearby" as const };
    }
    return { country: null, method: "unsupported" as const };
}

// Para pedir o cotizar un flete: si la recogida es en un país sin FleteYa, no se crea nada y la persona sabe
// en qué países sí operamos (la app escribe la lista en su idioma; aquí va en español para el panel y los registros)
export const requireCountryAt = async (lat: number, lng: number) => {
    const { country } = await detectCountry(lat, lng);
    if (!country) {
        const names = (await listCountries()).map((item) => item.names.es ?? item.code).sort((a, b) => a.localeCompare(b, "es"));
        throw new AppError("COUNTRY_NOT_SUPPORTED", 422, "COUNTRY_NOT_SUPPORTED", { countries: names.join(", ") });
    }
    return country;
}

// Tarifas del precio sugerido de un país: las suyas si el admin las cambió; si no, las de su moneda
export const ratesFor = async (country: CountryInfo) => {
    const [own, base, ownVehicles, baseVehicles] = await Promise.all([
        prisma.countryRate.findUnique({ where: { country_code: country.code } }),
        prisma.currencyRate.findUnique({ where: { currency_code: country.currency.code } }),
        prisma.countryVehicleRate.findMany({ where: { country_code: country.code } }),
        prisma.currencyVehicleRate.findMany({ where: { currency_code: country.currency.code } }),
    ]);
    const values = own ?? base;
    if (!values) throw new AppError("RATES_NOT_CONFIGURED", 500);
    const { km_value, min_value, weight_rate, size_rate, commission_rate } = values;
    const vehicles = baseVehicles.map((rate) => ownVehicles.find((item) => item.vehicle_type === rate.vehicle_type) ?? rate)
        .map(({ vehicle_type, base_fare, km_factor }) => ({ vehicle_type, base_fare, km_factor }));
    return { km_value, min_value, weight_rate, size_rate, commission_rate, vehicle_rates: vehicles, custom: own !== null || ownVehicles.length > 0 };
}

// Un precio de flete en su moneda: redondeado a sus decimales y dentro de sus límites. field es la clave del campo
// (fields.fare_offered...) para que el mensaje diga cuál está mal
export const checkFare = (value: number, currency: CurrencyInfo, field: string) => {
    const amount = roundMoney(value, currency.decimals);
    if (amount < currency.min_fare) {
        throw new AppError("FARE_MIN", 400, undefined, { field: `@fields.${field}`, min: formatMoney(currency.min_fare, currency.code, "es-CO") });
    }
    if (amount > currency.max_fare) {
        throw new AppError("FARE_MAX", 400, undefined, { field: `@fields.${field}`, max: formatMoney(currency.max_fare, currency.code, "es-CO") });
    }
    return amount;
}

// Celular de un contacto del flete (quien entrega o recibe), con el formato del país del flete
export const checkPhone = (phone: string | undefined, country: CountryInfo, field: string) => {
    if (phone && !new RegExp(country.phone_pattern).test(phone)) {
        throw new AppError("PHONE_FORMAT", 400, undefined, { field: `@fields.${field}`, example: country.phone_example });
    }
}

// Placa ya sin espacios ni guiones y en mayúsculas. Países sin formato propio aceptan de 2 a 10 letras o números
export const checkPlate = (plate: string, country: CountryInfo) => {
    if (country.plate_pattern && !new RegExp(country.plate_pattern).test(plate)) {
        throw new AppError("PLATE_FORMAT", 400);
    }
}

// Lo que la app necesita de cada país para el registro, el buscador y los precios
export const publicCountry = (country: CountryInfo) => ({
    code: country.code,
    names: country.names,
    currency: country.currency.code,
    default_language: country.default_language,
    decimals: country.currency.decimals,
    fare_step: country.currency.fare_step,
    min_fare: country.currency.min_fare,
    max_fare: country.currency.max_fare,
    phone_prefix: country.phone_prefix,
    phone_pattern: country.phone_pattern,
    phone_example: country.phone_example,
    plate_pattern: country.plate_pattern,
});
