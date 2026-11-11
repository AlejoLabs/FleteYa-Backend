import prisma from "../../database/prismaClient.js";
import { listCountries } from "../countries.service.js";
import { ExchangeRateService, type RateStore, type StoredRate } from "./exchangeRates.js";
import { frankfurterProvider, trmProvider } from "./rateProviders.js";

// El servicio de tipo de cambio que usa el backend: las dos fuentes reales y el respaldo en la tabla exchange_rates

// Respaldo en la base: la última tasa buena de cada moneda
export const prismaRateStore: RateStore = {
    load: async (): Promise<StoredRate[]> => {
        const rows = await prisma.exchangeRate.findMany();
        return rows.map((row) => ({
            currency: row.currency_code,
            units_per_usd: row.units_per_usd,
            source: row.source,
            rate_date: row.rate_date.toISOString().slice(0, 10),
            fetched_at: row.fetched_at,
        }));
    },
    save: async (rates) => {
        await prisma.$transaction(rates.map((rate) => prisma.exchangeRate.upsert({
            where: { currency_code: rate.currency },
            update: { units_per_usd: rate.units_per_usd, source: rate.source, rate_date: new Date(rate.rate_date), fetched_at: rate.fetched_at },
            create: { currency_code: rate.currency, units_per_usd: rate.units_per_usd, source: rate.source, rate_date: new Date(rate.rate_date), fetched_at: rate.fetched_at },
        })));
    },
};

// Las monedas de los países de FleteYa (COP, EUR, MXN...)
const usedCurrencies = async () => [...new Set((await listCountries()).map((country) => country.currency.code))];

export const exchangeRates = new ExchangeRateService({
    providers: [frankfurterProvider, trmProvider],
    store: prismaRateStore,
    currencies: usedCurrencies,
});

// Al arrancar y cada 30 minutos: así una petición casi nunca tiene que esperar a una fuente externa
const REFRESH_EVERY_MS = 30 * 60 * 1000;
export const startExchangeRateRefresh = () => {
    const refresh = () => exchangeRates.refresh().catch((err) => console.error("[tipo-de-cambio] error al refrescar", err));
    void refresh();
    return setInterval(refresh, REFRESH_EVERY_MS);
}
