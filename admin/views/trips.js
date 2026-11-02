// Viajes: todos con su estado, el detalle de cada uno y cerrar los que quedaron atascados
import { api, ask, date, facts, failure, h, INCIDENT_KIND, INCIDENT_STATUS, loading, money, pageHead, pager, PAYMENT_METHOD, PAYMENT_STATUS, percent, pill, table, toast, TRIP_STATUS, VEHICLES, show } from "../ui.js";

const state = { q: "", status: "", stuck: false, page: 1 };
const OPEN = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"];

export const renderTrips = async (container) => {
  const search = h("input", { type: "search", placeholder: "Id, dirección o correo", value: state.q, "aria-label": "Buscar" });
  const status = h("select", { "aria-label": "Estado" },
    h("option", { value: "" }, "Todos los estados"),
    Object.entries(TRIP_STATUS).map(([value, [label]]) => h("option", { value, selected: value === state.status }, label)));
  const stuck = h("input", { type: "checkbox", checked: state.stuck });
  const apply = () => { state.q = search.value.trim(); state.status = status.value; state.stuck = stuck.checked; state.page = 1; renderTrips(container); };
  const form = h("form", { class: "filters", onSubmit: (e) => { e.preventDefault(); apply(); } },
    search, status,
    h("label", { class: "row", style: { fontWeight: 500 } }, stuck, "Solo atascados"),
    h("button", { class: "btn dark", type: "submit" }, "Buscar"));
  status.addEventListener("change", apply);
  stuck.addEventListener("change", apply);

  const head = pageHead("Viajes", "Todos los fletes. Un viaje abierto sin cambios en varias horas aparece como atascado.");
  show(container, head, form, loading());
  try {
    const params = new URLSearchParams({ page: String(state.page), ...(state.q && { q: state.q }), ...(state.status && { status: state.status }), ...(state.stuck && { stuck: "1" }) });
    const result = await api("GET", `/trips?${params}`);
    show(container, head, form,
      table([
        { label: "Id", num: true, value: (t) => t.id },
        { label: "Ruta", value: (t) => h("div", { class: "stack", style: { gap: "0" } }, h("span", {}, t.pickup_description), h("span", { class: "muted small" }, `→ ${t.destination_description}`)) },
        { label: "Cliente", value: (t) => t.client },
        { label: "Conductor", value: (t) => t.driver ?? "—" },
        { label: "Valor", num: true, value: (t) => money(t.fare_assigned ?? t.fare_offered) },
        { label: "Pago", value: (t) => `${PAYMENT_METHOD[t.payment_method]}${t.paid_at ? " · pagado" : ""}` },
        { label: "Estado", value: (t) => h("span", { class: "row" }, pill(TRIP_STATUS, t.status), t.stuck ? h("span", { class: "pill danger" }, "Atascado") : null) },
        { label: "Creado", value: (t) => date(t.created_at) },
      ], result.items, { onRow: (t) => { location.hash = `#/viajes/${t.id}`; }, empty: "No hay viajes con estos filtros" }),
      pager(result, (page) => { state.page = page; renderTrips(container); }));
  } catch (err) {
    show(container, head, form, failure(err, () => renderTrips(container)));
  }
};

const OFFER_STATUS = { PENDING: ["Pendiente", "warning"], ACCEPTED: ["Aceptada", "success"], REJECTED: ["Rechazada", "neutral"], WITHDRAWN: ["Retirada", "neutral"], EXPIRED: ["Vencida", "neutral"] };

export const renderTrip = async (container, id) => {
  const back = h("a", { href: "#/viajes", class: "btn small back" }, "← Viajes");
  show(container, back, loading());
  let t;
  try {
    t = await api("GET", `/trips/${id}`);
  } catch (err) {
    return show(container, back, failure(err, () => renderTrip(container, id)));
  }

  const cancel = () => ask({
    title: "Cerrar el viaje",
    message: "Queda cancelado y al cliente y al conductor les llega un aviso con el motivo. Úsalo para viajes que quedaron abiertos.",
    confirm: "Cerrar viaje", tone: "danger",
    field: { label: "Motivo", placeholder: "Por ejemplo: viaje atascado, nadie lo terminó" },
    action: (reason) => api("PUT", `/trips/${id}/cancel`, { reason }),
  }).then((ok) => { if (ok) { toast("Viaje cerrado"); renderTrip(container, id); } });

  const fare = t.fare_assigned ?? t.fare_offered;
  const person = (p) => (p ? h("a", { href: `#/usuarios/${p.id}` }, p.name) : "—");

  show(container, 
    back,
    pageHead(`Flete #${t.id}`, `${t.pickup_description} → ${t.destination_description}`,
      pill(TRIP_STATUS, t.status),
      OPEN.includes(t.status) ? h("button", { class: "btn danger", onClick: cancel }, "Cerrar viaje") : null),
    t.status === "CANCELED" ? h("div", { class: "card" }, h("p", {}, h("strong", {}, "Motivo de la cancelación: "), t.cancel_reason ?? "—")) : null,

    h("div", { class: "grid" },
      h("section", { class: "card" }, h("h2", {}, "Carga"), facts([
        ["Descripción", t.cargo_description],
        ["Vehículo", VEHICLES[t.required_vehicle] ?? t.required_vehicle],
        ["Peso", t.weight_kg ? `${t.weight_kg} kg` : "—"],
        ["Artículos", t.packages],
        ["Ayudantes", t.helpers || "No"],
        ["Valor declarado", t.declared_value ? money(t.declared_value) : "—"],
        ["Programado", t.scheduled_at ? date(t.scheduled_at) : "Para ya"],
      ])),
      h("section", { class: "card" }, h("h2", {}, "Personas"), facts([
        ["Cliente", person(t.client)],
        ["Conductor", person(t.driver)],
        ["Calificación al conductor", t.driver_rating ?? "—"],
        ["Calificación al cliente", t.client_rating ?? "—"],
        ["Mensajes del chat", t.messages],
        ["Fotos", t.photos],
        ["Intentos del código", t.delivery_code_attempts],
      ])),
      h("section", { class: "card" }, h("h2", {}, "Dinero"), facts([
        ["Ofrecido por el cliente", money(t.fare_offered)],
        ["Acordado", t.fare_assigned ? money(t.fare_assigned) : "—"],
        ["Comisión", t.commission ? `${money(t.commission)} (${percent(t.commission_rate)})` : "—"],
        ["Le queda al conductor", t.commission ? money(fare - t.commission) : "—"],
        ["Forma de pago", PAYMENT_METHOD[t.payment_method]],
        ["Pagado", t.paid_at ? date(t.paid_at) : "No"],
        t.payment_method === "CASH" && t.paid_at ? ["Comisión liquidada", t.commission_settled_at ? date(t.commission_settled_at) : "Pendiente"] : null,
      ])),
    ),

    h("section", { class: "stack" }, h("h2", {}, "Ofertas"),
      table([
        { label: "Conductor", value: (o) => h("a", { href: `#/usuarios/${o.id_driver}` }, o.driver) },
        { label: "Valor", num: true, value: (o) => money(o.fare_offered) },
        { label: "Estado", value: (o) => pill(OFFER_STATUS, o.status) },
        { label: "Fecha", value: (o) => date(o.created_at) },
      ], t.offers, { empty: "Nadie ofertó" })),

    t.payments.length ? h("section", { class: "stack" }, h("h2", {}, "Intentos de pago"),
      table([
        { label: "Referencia", value: (p) => h("span", { class: "mono" }, p.reference) },
        { label: "Medio", value: (p) => p.wompi_method ?? PAYMENT_METHOD[p.method] },
        { label: "Monto", num: true, value: (p) => money(p.amount) },
        { label: "Estado", value: (p) => pill(PAYMENT_STATUS, p.status) },
        { label: "Fecha", value: (p) => date(p.created_at) },
      ], t.payments)) : null,

    t.incidents.length ? h("section", { class: "stack" }, h("h2", {}, "Incidentes"),
      table([
        { label: "Tipo", value: (i) => INCIDENT_KIND[i.kind] ?? i.kind },
        { label: "Estado", value: (i) => pill(INCIDENT_STATUS, i.status) },
        { label: "Fecha", value: (i) => date(i.created_at) },
      ], t.incidents, { onRow: (i) => { location.hash = `#/incidentes/${i.id}`; } })) : null,
  );
};
