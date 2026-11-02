// Usuarios: buscar clientes y conductores, ver su detalle y suspender, reactivar o anonimizar su cuenta
import { ACCOUNT, api, APPROVAL, ask, date, facts, failure, h, loading, money, number, pageHead, pager, pill, ROLES, table, toast, TRIP_STATUS, VEHICLES, show } from "../ui.js";

const state = { q: "", role: "", status: "", page: 1 };

export const renderUsers = async (container) => {
  const search = h("input", { type: "search", placeholder: "Nombre, correo, celular o id", value: state.q, "aria-label": "Buscar" });
  const role = h("select", { "aria-label": "Rol" }, [["", "Todos los roles"], ["CLIENT", "Clientes"], ["DRIVER", "Conductores"], ["ADMIN", "Admins"]]
    .map(([value, label]) => h("option", { value, selected: value === state.role }, label)));
  const status = h("select", { "aria-label": "Estado" }, [["", "Todas"], ["ACTIVE", "Activas"], ["SUSPENDED", "Suspendidas"]]
    .map(([value, label]) => h("option", { value, selected: value === state.status }, label)));
  const apply = () => { state.q = search.value.trim(); state.role = role.value; state.status = status.value; state.page = 1; renderUsers(container); };
  const form = h("form", { class: "filters", onSubmit: (e) => { e.preventDefault(); apply(); } },
    search, role, status, h("button", { class: "btn dark", type: "submit" }, "Buscar"));
  role.addEventListener("change", apply);
  status.addEventListener("change", apply);

  const head = pageHead("Usuarios", "Clientes y conductores. Las cuentas anonimizadas no aparecen.");
  show(container, head, form, loading());
  try {
    const params = new URLSearchParams({ page: String(state.page), ...(state.q && { q: state.q }), ...(state.role && { role: state.role }), ...(state.status && { status: state.status }) });
    const result = await api("GET", `/users?${params}`);
    show(container, head, form,
      table([
        { label: "Id", num: true, value: (u) => u.id },
        { label: "Nombre", value: (u) => h("div", { class: "stack", style: { gap: "0" } }, h("strong", {}, u.name), h("span", { class: "muted small" }, u.email)) },
        { label: "Celular", value: (u) => u.phone || "—" },
        { label: "Roles", value: (u) => u.roles.map((r) => ROLES[r] ?? r).join(", ") },
        { label: "Vehículo", value: (u) => u.vehicle ? h("span", { class: "row" }, `${VEHICLES[u.vehicle.vehicle_type] ?? ""} ${u.vehicle.plate}`, pill(APPROVAL, u.vehicle.approval_status)) : "—" },
        { label: "Cuenta", value: (u) => pill(ACCOUNT, u.status) },
        { label: "Desde", value: (u) => date(u.created_at).split(",")[0] },
      ], result.items, { onRow: (u) => { location.hash = `#/usuarios/${u.id}`; }, empty: "Nadie coincide con la búsqueda" }),
      pager(result, (page) => { state.page = page; renderUsers(container); }));
  } catch (err) {
    show(container, head, form, failure(err, () => renderUsers(container)));
  }
};

const tripCounts = (counts) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return "Ninguno";
  return `${number(total)} (${number(counts.FINISHED ?? 0)} entregados, ${number(counts.CANCELED ?? 0)} cancelados)`;
};

const rating = (r) => (r ? `${Number(r.average).toFixed(1).replace(".", ",")} ★ (${r.count})` : "Sin calificaciones");

export const renderUser = async (container, id) => {
  const back = h("a", { href: "#/usuarios", class: "btn small back" }, "← Usuarios");
  show(container, back, loading());
  let u;
  try {
    u = await api("GET", `/users/${id}`);
  } catch (err) {
    return show(container, back, failure(err, () => renderUser(container, id)));
  }
  const reload = () => renderUser(container, id);

  const suspend = () => ask({
    title: "Suspender cuenta",
    message: `${u.name} sale de la app al instante y no puede volver a entrar hasta que la reactives. Verá este motivo.`,
    confirm: "Suspender", tone: "danger",
    field: { label: "Motivo", placeholder: "Por ejemplo: reportes repetidos de cobros por fuera de la app", multiline: true },
    action: (reason) => api("PUT", `/users/${id}/suspend`, { reason }),
  }).then((ok) => { if (ok) { toast("Cuenta suspendida"); reload(); } });

  const reactivate = () => ask({
    title: "Reactivar cuenta", message: `${u.name} podrá volver a entrar a la app.`, confirm: "Reactivar", tone: "success",
    action: () => api("PUT", `/users/${id}/reactivate`),
  }).then((ok) => { if (ok) { toast("Cuenta reactivada", "success"); reload(); } });

  const anonymize = () => ask({
    title: "Borrar datos personales",
    message: "Solo cuando la persona lo pide (Ley 1581 de 2012). Se borran su nombre, correo, celular, foto y documentos; sus viajes y pagos se conservan sin datos personales. No se puede deshacer. Escribe BORRAR para confirmar.",
    confirm: "Borrar datos", tone: "danger",
    field: { label: "Confirmación", placeholder: "BORRAR" },
    action: async (value) => {
      if (value !== "BORRAR") throw new Error("Escribe BORRAR, en mayúsculas, para confirmar");
      return api("POST", `/users/${id}/anonymize`);
    },
  }).then((ok) => { if (ok) { toast("Datos personales borrados"); reload(); } });

  const gone = Boolean(u.anonymized_at);
  show(container, 
    back,
    pageHead(u.name, `Cuenta #${u.id} · ${u.roles.map((r) => ROLES[r] ?? r).join(", ")}`,
      pill(ACCOUNT, u.status),
      !gone && u.status === "ACTIVE" ? h("button", { class: "btn danger", onClick: suspend }, "Suspender") : null,
      !gone && u.status === "SUSPENDED" ? h("button", { class: "btn success", onClick: reactivate }, "Reactivar") : null,
      !gone ? h("button", { class: "btn", onClick: anonymize }, "Borrar datos personales") : null),
    gone ? h("div", { class: "card" }, h("p", {}, `Datos personales borrados el ${date(u.anonymized_at)}. Sus viajes se conservan.`)) : null,
    u.status === "SUSPENDED" && !gone ? h("div", { class: "card", style: { borderColor: "var(--danger)" } }, h("p", {}, h("strong", {}, "Motivo de la suspensión: "), u.status_reason ?? "—")) : null,

    h("div", { class: "grid" },
      h("section", { class: "card" }, h("h2", {}, "Datos"), facts([
        ["Correo", u.email],
        ["Correo comprobado", u.email_verified ? "Sí" : "No"],
        ["Celular", u.phone || "—"],
        ["Entra con Google", u.has_google ? "Sí" : "No"],
        ["Registrado", date(u.created_at)],
      ])),
      h("section", { class: "card" }, h("h2", {}, "Actividad"), facts([
        ["Fletes como cliente", tripCounts(u.trips_as_client)],
        ["Fletes como conductor", tripCounts(u.trips_as_driver)],
        ["Calificación como conductor", rating(u.rating_as_driver)],
        ["Calificación como cliente", rating(u.rating_as_client)],
        ["Incidentes en sus viajes", number(u.incidents)],
      ])),
      u.vehicle ? h("section", { class: "card" }, h("h2", {}, "Vehículo"), facts([
        ["Tipo", VEHICLES[u.vehicle.vehicle_type] ?? u.vehicle.vehicle_type],
        ["Marca", u.vehicle.brand],
        ["Placa", u.vehicle.plate],
        ["Verificación", pill(APPROVAL, u.vehicle.approval_status)],
      ]), h("a", { href: `#/conductores/${u.id}` }, "Revisar vehículo y documentos")) : null,
    ),

    h("section", { class: "stack" }, h("h2", {}, "Últimos viajes"),
      table([
        { label: "Id", num: true, value: (t) => t.id },
        { label: "Como", value: (t) => (t.role === "CLIENT" ? "Cliente" : "Conductor") },
        { label: "Ruta", value: (t) => `${t.pickup_description} → ${t.destination_description}` },
        { label: "Valor", num: true, value: (t) => money(t.fare_assigned ?? t.fare_offered) },
        { label: "Estado", value: (t) => pill(TRIP_STATUS, t.status) },
        { label: "Fecha", value: (t) => date(t.created_at) },
      ], u.recent_trips, { onRow: (t) => { location.hash = `#/viajes/${t.id}`; }, empty: "Todavía no tiene viajes" })),
  );
};
