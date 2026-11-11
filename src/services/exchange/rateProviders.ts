import axios from "axios";

// Las dos fuentes públicas y gratuitas del tipo de cambio, sin clave. Cada una dice cuántas unidades de una moneda
// vale un dólar (base común USD), y la fecha en que se publicó la tasa:
//   - Frankfurter: tasas de referencia del Banco Central Europeo. No publica el peso colombiano.
//   - TRM: Tasa Representativa del Mercado del Banco de la República, en datos.gov.co (pesos por dólar).
// Son servicios independientes: si uno se cae, el otro sigue (exchange_rates.service los consulta por separado)

export interface ProviderResult {
    // Unidades de cada moneda por 1 USD: { EUR: 0.89, MXN: 18.6 }
    rates: Record<string, number>;
    // Día al que corresponde la tasa, AAAA-MM-DD
    date: string;
}

export interface RateProvider {
    // FRANKFURTER o TRM: queda guardado en cada tasa
    name: string;
    // Las monedas que publica esta fuente, de las que FleteYa usa
    covers: (currency: string) => boolean;
    fetch: (currencies: string[]) => Promise<ProviderResult>;
}

// Un servicio lento cuenta como caído: nadie espera más que esto
export const PROVIDER_TIMEOUT_MS = 5000;

const isRate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export const frankfurterProvider: RateProvider = {
    name: "FRANKFURTER",
    covers: (currency) => currency !== "COP" && currency !== "USD",
    fetch: async (currencies) => {
        const response = await axios.get("https://api.frankfurter.dev/v1/latest", {
            params: { base: "USD", symbols: currencies.join(",") },
            timeout: PROVIDER_TIMEOUT_MS,
        });
        const rates: Record<string, number> = {};
        for (const currency of currencies) {
            const value = response.data?.rates?.[currency];
            if (isRate(value)) rates[currency] = value;
        }
        if (!Object.keys(rates).length || typeof response.data?.date !== "string") {
            throw new Error("Frankfurter respondió sin tasas");
        }
        return { rates, date: response.data.date };
    },
};

// Dataset "Tasa de Cambio Representativa del Mercado - Histórico" (Superintendencia Financiera, consulta SODA)
const TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json";

export const trmProvider: RateProvider = {
    name: "TRM",
    covers: (currency) => currency === "COP",
    fetch: async () => {
        const response = await axios.get(TRM_URL, {
            params: { $order: "vigenciadesde DESC", $limit: 1 },
            timeout: PROVIDER_TIMEOUT_MS,
        });
        const row = Array.isArray(response.data) ? response.data[0] : null;
        const value = Number(row?.valor);
        if (!isRate(value) || row?.unidad !== "COP" || typeof row?.vigenciadesde !== "string") {
            throw new Error("La TRM respondió sin un valor válido");
        }
        return { rates: { COP: value }, date: row.vigenciadesde.slice(0, 10) };
    },
};
