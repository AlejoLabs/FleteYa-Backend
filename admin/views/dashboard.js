// Inicio: las cifras del negocio en los últimos 7, 30 o 90 días
import { api, barList, date, day, dayColumns, failure, h, loading, money, moneyList, number, pageHead, TRIP_STATUS, VEHICLES, show } from "../ui.js";

let days = 30;

// Las dos fuentes del tipo de cambio: OK, en espera (falló y se reintenta más tarde) o caída
const SOURCE_NAMES = { FRANKFURTER: "Banco Central Europeo (Frankfurter)", TRM: "TRM del Banco de la República" };
const sourceLine = (source) => h("li", {},
  h("strong", {}, SOURCE_NAMES[source.name] ?? source.name), ": ",
  source.status === "OK"
    ? h("span", { class: "pill success" }, "Funciona")
    : h("span", { class: "pill danger" }, `Sin respuesta, se reintenta ${date(source.retry_at)}`),
  source.error ? h("span", { class: "muted small" }, ` (${source.error})`) : null);

const tile = (value, label, { alert = false, href } = {}) => {
  const node = h("div", { class: `tile${alert ? " alert" : ""}` }, h("span", { class: "n" }, value), h("span", { class: "l" }, label));
  return href ? h("a", { href, style: { textDecoration: "none", color: "inherit" } }, node) : node;
};

// Todos los días del periodo, con cero los que no tuvieron fletes: así el eje del tiempo no se encoge
const everyDay = (perDay, count) => {
  const byDay = new Map(perDay.map((p) => [String(p.day).slice(0, 10), p.created]));
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - i)));
    const key = d.toISOString().slice(0, 10);
    return { day: key, value: byDay.get(key) ?? 0 };
  });
};

export const renderDashboard = async (container) => {
  const range = h("select", { "aria-label": "Periodo", onChange: (e) => { days = Number(e.target.value); renderDashboard(container); } },
    [7, 30, 90].map((n) => h("option", { value: n, selected: n === days }, `Últimos ${n} días`)));
  show(container, pageHead("Inicio", "Cómo va FleteYa", range), loading());

  let stats;
  try {
    stats = await api("GET", `/stats?days=${days}`);
  } catch (err) {
    return show(container, pageHead("Inicio", "Cómo va FleteYa", range), failure(err, () => renderDashboard(container)));
  }
  const { users, drivers, trips, money: cash } = stats;
  const byStatus = trips.by_status;
  const created = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const finished = byStatus.FINISHED ?? 0;
  const canceled = byStatus.CANCELED ?? 0;

  show(container, 
    pageHead("Inicio", "Cómo va FleteYa", range),

    h("div", { class: "tiles" },
      tile(number(created), "fletes publicados"),
      tile(number(finished), "fletes entregados"),
      tile(created ? `${Math.round((canceled / created) * 100)} %` : "—", "se cancelaron"),
      tile(trips.avg_minutes_to_driver === null ? "—" : `${String(trips.avg_minutes_to_driver).replace(".", ",")} min`, "en conseguir conductor (promedio)"),
      // Cada moneda por separado: los pesos y los euros no se suman
      tile(moneyList(cash.by_currency, "commission"), "ganado en comisiones"),
      tile(moneyList(cash.by_currency.filter((row) => row.cash_commission_pending > 0), "cash_commission_pending"), "comisión en efectivo por cobrar",
        { alert: cash.by_currency.some((row) => row.cash_commission_pending > 0), href: "#/pagos" }),
    ),

    h("div", { class: "grid" },
      h("section", { class: "card", "aria-labelledby": "t-days" },
        h("h2", { id: "t-days" }, "Fletes publicados por día"),
        dayColumns(everyDay(trips.per_day, days), "fletes")),
      h("section", { class: "card", "aria-labelledby": "t-status" },
        h("h2", { id: "t-status" }, "Fletes por estado"),
        barList(Object.keys(TRIP_STATUS).filter((s) => byStatus[s]).map((s) => ({ label: TRIP_STATUS[s][0], value: byStatus[s] })))),
    ),

    h("div", { class: "grid" },
      h("section", { class: "card", "aria-labelledby": "t-cancel" },
        h("h2", { id: "t-cancel" }, "Por qué se cancelan"),
        barList(trips.cancel_reasons.map((r) => ({ label: r.reason, value: r.count })), { empty: "Ninguna cancelación en este periodo" })),
      h("section", { class: "card", "aria-labelledby": "t-fare" },
        h("h2", { id: "t-fare" }, "Precio promedio por vehículo"),
        // Un promedio por vehículo y moneda; las barras se comparan dentro de cada moneda
        [...new Set(trips.fare_by_vehicle.map((v) => v.currency))].map((currency) => h("div", { class: "stack" },
          h("h3", {}, currency),
          barList(trips.fare_by_vehicle.filter((v) => v.currency === currency).map((v) => ({ label: `${VEHICLES[v.vehicle] ?? v.vehicle} (${number(v.trips)})`, value: v.avg_fare })),
            { format: (value) => money(value, currency) }))),
        trips.fare_by_vehicle.length ? null : h("p", { class: "muted" }, "Ningún flete entregado en este periodo")),
    ),

    h("section", { class: "card", "aria-labelledby": "t-usd" },
      h("h2", { id: "t-usd" }, "Totales aproximados en dólares"),
      h("p", { class: "muted small" }, "Solo como referencia: cada viaje se cobra en su moneda. Se convierte con el tipo de cambio de referencia",
        cash.approx_usd.rate_date ? ` del ${day(cash.approx_usd.rate_date)}` : "",
        cash.approx_usd.stale ? " (alguna fuente no respondió: se usó la última tasa guardada)." : "."),
      h("div", { class: "tiles" },
        tile(cash.approx_usd.paid_volume === null ? "—" : `≈ ${money(cash.approx_usd.paid_volume, "USD")}`, "pagado por los clientes"),
        tile(cash.approx_usd.commission === null ? "—" : `≈ ${money(cash.approx_usd.commission, "USD")}`, "en comisiones"),
        tile(cash.approx_usd.cash_commission_pending === null ? "—" : `≈ ${money(cash.approx_usd.cash_commission_pending, "USD")}`, "comisión en efectivo por cobrar")),
      h("ul", { class: "stack small" }, cash.exchange_sources.map(sourceLine))),

    h("div", { class: "tiles" },
      tile(number(users.clients), "clientes"),
      tile(number(users.drivers), "conductores"),
      tile(number(users.new_users), "cuentas nuevas en el periodo"),
      tile(number(drivers.available_now), "conductores disponibles ahora"),
      tile(number(drivers.pending), "conductores por revisar", { alert: drivers.pending > 0, href: "#/conductores" }),
      tile(number(users.suspended), "cuentas suspendidas", { href: "#/usuarios" }),
    ),
  );
};
