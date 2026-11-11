import { PROVIDER_TIMEOUT_MS, type ProviderResult, type RateProvider } from "./rateProviders.js";

// Tipo de cambio de referencia (Fase 9c). Lo usa la app para mostrar "≈ US$27" cuando el flete es en otra moneda,
// y el panel para dar totales aproximados. Nunca decide un cobro: los montos de un viaje siempre van en su moneda.
//
// Se arma con dos servicios externos independientes (rateProviders.ts) y cada uno se trata por separado:
//   1. Caché en memoria: una tasa sirve CACHE_TTL_MS; mientras tanto no se vuelve a preguntar.
//   2. Una sola consulta a la vez por fuente: si llegan diez peticiones juntas, esperan la misma respuesta.
//   3. Tiempo límite: una fuente que no responde en PROVIDER_TIMEOUT_MS cuenta como caída.
//   4. Cortacircuito: tras una falla, esa fuente no se vuelve a llamar hasta que pase la espera, que se duplica
//      con cada falla seguida (5 min, 10, 20... hasta 1 hora). Así una fuente caída no frena cada petición.
//   5. Respaldo: cada tasa buena se guarda en la base (exchange_rates). Si la fuente falla, se usa la última
//      guardada y se marca stale (vieja), con su fecha, para que la app diga "aprox." con honestidad.
// Si una fuente se cae, las monedas de la otra siguen frescas.

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const FIRST_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_COOLDOWN_MS = 60 * 60 * 1000;

// Lo que se guarda en la base: unidades de la moneda por 1 USD, de qué fuente y de qué día
export interface StoredRate {
    currency: string;
    units_per_usd: number;
    source: string;
    rate_date: string;
    fetched_at: Date;
}

export interface RateStore {
    load(): Promise<StoredRate[]>;
    save(rates: StoredRate[]): Promise<void>;
}

export interface RateInfo {
    units_per_usd: number;
    source: string;
    rate_date: string;
    // true: no se pudo consultar la fuente ahora; es la última tasa guardada
    stale: boolean;
}

export type SourceStatus = "OK" | "DOWN" | "WAITING";

export interface RatesSnapshot {
    base: "USD";
    rates: Record<string, RateInfo>;
    sources: { name: string; status: SourceStatus; checked_at: Date | null; error: string | null; retry_at: Date | null }[];
}

interface SourceState {
    cache: (ProviderResult & { fetched_at: number }) | null;
    failures: number;
    down_until: number;
    checked_at: number | null;
    error: string | null;
    in_flight: Promise<void> | null;
}

interface Options {
    providers: RateProvider[];
    store: RateStore;
    // Monedas que usa FleteYa (la tabla currencies)
    currencies: () => Promise<string[]>;
    now?: () => number;
    timeoutMs?: number;
    ttlMs?: number;
    log?: (message: string) => void;
}

const withTimeout = <T>(promise: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms} ms`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});

export class ExchangeRateService {
    private readonly providers: RateProvider[];
    private readonly store: RateStore;
    private readonly currencies: () => Promise<string[]>;
    private readonly now: () => number;
    private readonly timeoutMs: number;
    private readonly ttlMs: number;
    private readonly log: (message: string) => void;
    private readonly state = new Map<string, SourceState>();

    constructor(options: Options) {
        this.providers = options.providers;
        this.store = options.store;
        this.currencies = options.currencies;
        this.now = options.now ?? Date.now;
        this.timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
        this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
        this.log = options.log ?? ((message) => console.log(`[tipo-de-cambio] ${message}`));
        for (const provider of this.providers) {
            this.state.set(provider.name, { cache: null, failures: 0, down_until: 0, checked_at: null, error: null, in_flight: null });
        }
    }

    // Consulta las fuentes cuya tasa venció y que no están en espera. Nunca lanza: una falla queda en su estado
    async refresh(): Promise<void> {
        const currencies = await this.currencies();
        await Promise.all(this.providers.map((provider) => this.refreshSource(provider, currencies)));
    }

    private refreshSource(provider: RateProvider, currencies: string[]): Promise<void> {
        const state = this.state.get(provider.name)!;
        const now = this.now();
        const fresh = state.cache && now - state.cache.fetched_at < this.ttlMs;
        if (fresh || now < state.down_until) return Promise.resolve();
        // Ya hay una consulta en curso: se espera esa misma
        if (state.in_flight) return state.in_flight;

        const wanted = currencies.filter(provider.covers);
        if (!wanted.length) return Promise.resolve();

        state.in_flight = (async () => {
            try {
                const result = await withTimeout(provider.fetch(wanted), this.timeoutMs);
                const fetchedAt = this.now();
                state.cache = { ...result, fetched_at: fetchedAt };
                state.failures = 0;
                state.down_until = 0;
                state.error = null;
                await this.store.save(Object.entries(result.rates).map(([currency, units]) => ({
                    currency, units_per_usd: units, source: provider.name, rate_date: result.date, fetched_at: new Date(fetchedAt),
                }))).catch((err) => this.log(`no se pudo guardar el respaldo de ${provider.name}: ${err?.message ?? err}`));
            } catch (err: any) {
                state.failures += 1;
                const cooldown = Math.min(FIRST_COOLDOWN_MS * 2 ** (state.failures - 1), MAX_COOLDOWN_MS);
                state.down_until = this.now() + cooldown;
                state.error = String(err?.message ?? err).slice(0, 200);
                this.log(`${provider.name} falló (${state.error}); se usa la última tasa guardada y se reintenta en ${Math.round(cooldown / 60000)} min`);
            } finally {
                state.checked_at = this.now();
                state.in_flight = null;
            }
        })();
        return state.in_flight;
    }

    // Las tasas que hay ahora: las frescas de cada fuente y, de las que fallaron, la última guardada (stale)
    async getRates(): Promise<RatesSnapshot> {
        await this.refresh();
        const now = this.now();
        const rates: Record<string, RateInfo> = { USD: { units_per_usd: 1, source: "BASE", rate_date: new Date(now).toISOString().slice(0, 10), stale: false } };

        for (const provider of this.providers) {
            const cache = this.state.get(provider.name)!.cache;
            if (!cache || now - cache.fetched_at >= this.ttlMs * 4) continue;
            for (const [currency, units] of Object.entries(cache.rates)) {
                rates[currency] = { units_per_usd: units, source: provider.name, rate_date: cache.date, stale: now - cache.fetched_at >= this.ttlMs };
            }
        }
        // Las monedas que ninguna fuente pudo dar ahora salen de la base
        const missing = (await this.currencies()).filter((currency) => !rates[currency]);
        if (missing.length) {
            const stored = await this.store.load().catch(() => [] as StoredRate[]);
            for (const row of stored) {
                if (missing.includes(row.currency)) {
                    rates[row.currency] = { units_per_usd: row.units_per_usd, source: row.source, rate_date: row.rate_date, stale: true };
                }
            }
        }

        return {
            base: "USD",
            rates,
            sources: this.providers.map((provider) => {
                const state = this.state.get(provider.name)!;
                const status: SourceStatus = state.error === null ? "OK" : now < state.down_until ? "WAITING" : "DOWN";
                return {
                    name: provider.name,
                    status,
                    checked_at: state.checked_at === null ? null : new Date(state.checked_at),
                    error: state.error,
                    retry_at: state.error === null ? null : new Date(state.down_until),
                };
            }),
        };
    }
}

// Convierte un monto entre dos monedas con las tasas del momento; null si falta alguna de las dos
export const convertAmount = (amount: number, from: string, to: string, rates: Record<string, RateInfo>): number | null => {
    if (from === to) return amount;
    const source = rates[from]?.units_per_usd;
    const target = rates[to]?.units_per_usd;
    if (!source || !target) return null;
    return (amount / source) * target;
}
