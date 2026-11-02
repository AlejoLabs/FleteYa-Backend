// Inicio: las cifras del negocio en los últimos 7, 30 o 90 días
import { api, barList, dayColumns, failure, h, loading, money, number, pageHead, TRIP_STATUS, VEHICLES, show } from "../ui.js";

let days = 30;

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
      tile(money(cash.commission), "ganado en comisiones"),
      tile(money(cash.cash_commission_pending), "comisión en efectivo por cobrar", { alert: cash.cash_commission_pending > 0, href: "#/pagos" }),
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
        barList(trips.fare_by_vehicle.map((v) => ({ label: `${VEHICLES[v.vehicle] ?? v.vehicle} (${number(v.trips)})`, value: v.avg_fare })),
          { format: money, empty: "Ningún flete entregado en este periodo" })),
    ),

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
