// Fase 9c: tipo de cambio de referencia con dos servicios externos independientes (Frankfurter y la TRM).
// Prueba el servicio con fuentes de mentira: así se pueden tumbar a propósito, una por una o las dos, sin depender
// de internet. Lo que se revisa: caché, una sola consulta a la vez, tiempo límite, cortacircuito y respaldo en la base.
// La consulta real de GET /exchange-rates está en countries.test.mjs (con fetch; esta suite no usa la red). Uso: npm test
import { createReport } from "./support/api.mjs";
import { CACHE_TTL_MS, ExchangeRateService, FIRST_COOLDOWN_MS, convertAmount, type RateStore, type StoredRate } from "../src/services/exchange/exchangeRates.js";
import type { RateProvider } from "../src/services/exchange/rateProviders.js";

const { check, finish } = createReport();
const CURRENCIES = ["COP", "USD", "EUR", "MXN"];

// Fuente de mentira: cuenta las llamadas y se puede apagar, volver lenta o volver a prender
const fakeProvider = (name: string, covers: string[], rates: Record<string, number>) => {
    const control = { calls: 0, mode: "up" as "up" | "down" | "hang", rates, date: "2026-11-10" };
    const provider: RateProvider = {
        name,
        covers: (currency) => covers.includes(currency),
        fetch: async (currencies) => {
            control.calls += 1;
            if (control.mode === "down") throw new Error(`${name} caído`);
            if (control.mode === "hang") return new Promise(() => {});
            return { rates: Object.fromEntries(currencies.map((c) => [c, control.rates[c]!])), date: control.date };
        },
    };
    return { provider, control };
};

// La base de mentira: guarda lo que se le pide, como la tabla exchange_rates
const memoryStore = (initial: StoredRate[] = []) => {
    const rows = new Map(initial.map((row) => [row.currency, row]));
    const store: RateStore & { rows: typeof rows } = {
        rows,
        load: async () => [...rows.values()],
        save: async (rates) => { for (const rate of rates) rows.set(rate.currency, rate); },
    };
    return store;
};

const setup = (initial: StoredRate[] = []) => {
    let clock = Date.parse("2026-11-10T12:00:00Z");
    const ecb = fakeProvider("FRANKFURTER", ["EUR", "MXN"], { EUR: 0.9, MXN: 18 });
    const trm = fakeProvider("TRM", ["COP"], { COP: 4000 });
    const store = memoryStore(initial);
    const service = new ExchangeRateService({
        providers: [ecb.provider, trm.provider], store, currencies: async () => CURRENCIES,
        now: () => clock, timeoutMs: 50, log: () => {},
    });
    return { service, ecb: ecb.control, trm: trm.control, store, advance: (ms: number) => { clock += ms; } };
};

const lastKnown = (currency: string, units: number, source: string): StoredRate =>
    ({ currency, units_per_usd: units, source, rate_date: "2026-11-03", fetched_at: new Date("2026-11-03T12:00:00Z") });

// 1. Las dos fuentes funcionan
{
    const { service, ecb, trm, store } = setup();
    const snapshot = await service.getRates();
    check("Las dos fuentes responden: COP de la TRM, EUR y MXN del Banco Central Europeo", snapshot.rates.COP?.source === "TRM" && snapshot.rates.EUR?.source === "FRANKFURTER" && snapshot.rates.MXN?.units_per_usd === 18);
    check("Nada sale marcado como viejo", Object.values(snapshot.rates).every((rate) => !rate.stale));
    check("El dólar es la base (1)", snapshot.rates.USD?.units_per_usd === 1);
    check("Cada tasa buena se guarda en la base como respaldo", store.rows.get("COP")?.units_per_usd === 4000 && store.rows.get("EUR")?.source === "FRANKFURTER");
    check("Una consulta por fuente", ecb.calls === 1 && trm.calls === 1);
    check("Las dos fuentes quedan OK", snapshot.sources.every((source) => source.status === "OK"));
}

// 2. Caché: mientras la tasa sirve no se vuelve a preguntar
{
    const { service, ecb, trm, advance } = setup();
    await service.getRates();
    advance(CACHE_TTL_MS - 1000);
    await service.getRates();
    check("Dentro de las 6 horas de caché no se llama otra vez a las fuentes", ecb.calls === 1 && trm.calls === 1);
    advance(2000);
    await service.getRates();
    check("Vencida la caché, se vuelve a preguntar", ecb.calls === 2 && trm.calls === 2);
}

// 3. Una sola consulta a la vez: diez peticiones juntas esperan la misma respuesta
{
    const { service, ecb, trm } = setup();
    const all = await Promise.all(Array.from({ length: 10 }, () => service.getRates()));
    check("Diez peticiones a la vez hacen una sola consulta por fuente", ecb.calls === 1 && trm.calls === 1 && all.every((s) => s.rates.COP?.units_per_usd === 4000));
}

// 4. Frankfurter caído: el euro sale de la última tasa guardada; el peso sigue fresco por la TRM
{
    const { service, ecb, trm } = setup([lastKnown("EUR", 0.88, "FRANKFURTER"), lastKnown("MXN", 17.5, "FRANKFURTER")]);
    ecb.mode = "down";
    const snapshot = await service.getRates();
    check("Frankfurter caído: EUR sale de la base, marcado viejo y con su fecha", snapshot.rates.EUR?.units_per_usd === 0.88 && snapshot.rates.EUR.stale && snapshot.rates.EUR.rate_date === "2026-11-03");
    check("Frankfurter caído: COP sigue fresco (la TRM no se entera)", snapshot.rates.COP?.units_per_usd === 4000 && !snapshot.rates.COP.stale && trm.calls === 1);
    const ecbStatus = snapshot.sources.find((source) => source.name === "FRANKFURTER");
    check("Frankfurter queda en espera y dice por qué", ecbStatus?.status === "WAITING" && /caído/.test(ecbStatus.error ?? ""));
}

// 5. TRM caída: el peso sale de la base; el euro sigue fresco
{
    const { service, ecb, trm } = setup([lastKnown("COP", 3950, "TRM")]);
    trm.mode = "down";
    const snapshot = await service.getRates();
    check("TRM caída: COP sale de la última tasa guardada, marcado viejo", snapshot.rates.COP?.units_per_usd === 3950 && snapshot.rates.COP.stale);
    check("TRM caída: EUR sigue fresco", snapshot.rates.EUR?.units_per_usd === 0.9 && !snapshot.rates.EUR.stale && ecb.calls === 1);
    check("Con el peso viejo igual se puede dar una referencia: 39.500 COP ≈ 10 USD", convertAmount(39500, "COP", "USD", snapshot.rates) === 10);
}

// 6. Las dos caídas y sin respaldo: no hay referencia, pero nada se rompe
{
    const { service, ecb, trm } = setup();
    ecb.mode = "down";
    trm.mode = "down";
    const snapshot = await service.getRates();
    check("Las dos caídas y la base vacía: solo queda el dólar, sin lanzar errores", Object.keys(snapshot.rates).join() === "USD");
    check("Sin tasa no se inventa una referencia (null)", convertAmount(100, "EUR", "COP", snapshot.rates) === null);
}

// 7. Cortacircuito: una fuente caída no se llama en cada petición; vuelve sola cuando se recupera
{
    const { service, ecb, advance } = setup([lastKnown("EUR", 0.88, "FRANKFURTER")]);
    ecb.mode = "down";
    await service.getRates();
    await service.getRates();
    await service.getRates();
    check("Caída una vez, no se vuelve a llamar durante la espera (5 min)", ecb.calls === 1);
    advance(FIRST_COOLDOWN_MS + 1000);
    await service.getRates();
    check("Pasada la espera se reintenta", ecb.calls === 2);
    advance(FIRST_COOLDOWN_MS + 1000);
    await service.getRates();
    check("Falló otra vez: la espera se duplica (a los 5 min todavía no reintenta)", ecb.calls === 2);
    advance(FIRST_COOLDOWN_MS);
    ecb.mode = "up";
    const recovered = await service.getRates();
    check("A los 10 min reintenta, se recupera y el euro vuelve fresco", ecb.calls === 3 && recovered.rates.EUR?.units_per_usd === 0.9 && !recovered.rates.EUR.stale);
    check("Recuperada, la fuente vuelve a OK", recovered.sources.find((s) => s.name === "FRANKFURTER")?.status === "OK");
}

// 8. Tiempo límite: una fuente que no contesta no deja colgada la petición
{
    const { service, trm } = setup([lastKnown("COP", 3950, "TRM")]);
    trm.mode = "hang";
    const started = Date.now();
    const snapshot = await service.getRates();
    const elapsed = Date.now() - started;
    check("La TRM no contesta: a los 50 ms se da por caída y se usa la última guardada", elapsed < 1000 && snapshot.rates.COP?.stale === true, `${elapsed} ms`);
}

// 9. La base falla al guardar: la tasa fresca igual sirve
{
    const { service, store } = setup();
    store.save = async () => { throw new Error("base caída"); };
    const snapshot = await service.getRates();
    check("Si no se puede guardar el respaldo, la tasa fresca igual se usa", snapshot.rates.COP?.units_per_usd === 4000 && !snapshot.rates.COP.stale);
}

// 10. Conversiones
{
    const rates = { USD: { units_per_usd: 1, source: "BASE", rate_date: "", stale: false }, EUR: { units_per_usd: 0.9, source: "X", rate_date: "", stale: false }, COP: { units_per_usd: 4000, source: "X", rate_date: "", stale: false } };
    check("27 € ≈ 30 USD", Math.abs(convertAmount(27, "EUR", "USD", rates)! - 30) < 1e-9);
    check("100.000 COP ≈ 22,50 €", Math.abs(convertAmount(100000, "COP", "EUR", rates)! - 22.5) < 1e-9);
    check("Misma moneda: el mismo monto", convertAmount(42, "COP", "COP", rates) === 42);
}

finish();
