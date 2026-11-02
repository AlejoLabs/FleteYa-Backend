// Conductores: la cola de verificación y la ficha de cada uno para aprobar o rechazar
import { ACCOUNT, api, APPROVAL, ask, date, facts, failure, h, loading, pageHead, pill, table, toast, VEHICLES, show } from "../ui.js";

let filter = "PENDING";
const FILTERS = [["PENDING", "Por revisar"], ["APPROVED", "Aprobados"], ["REJECTED", "Rechazados"], ["", "Todos"]];

export const renderDrivers = async (container) => {
  const tabs = h("div", { class: "row", role: "group", "aria-label": "Filtrar" },
    FILTERS.map(([value, label]) => h("button", {
      class: `btn small${value === filter ? " dark" : ""}`, "aria-pressed": value === filter,
      onClick: () => { filter = value; renderDrivers(container); },
    }, label)));
  const head = pageHead("Conductores", "Revisa el vehículo, la placa, las fotos y los documentos antes de aprobar. Solo los aprobados reciben fletes.");
  show(container, head, tabs, loading());
  try {
    const drivers = await api("GET", `/drivers${filter ? `?approval=${filter}` : ""}`);
    show(container, head, tabs, table([
      { label: "Conductor", value: (d) => h("div", { class: "stack", style: { gap: "0" } }, h("strong", {}, d.name), h("span", { class: "muted small" }, d.email)) },
      { label: "Vehículo", value: (d) => `${VEHICLES[d.vehicle_type] ?? d.vehicle_type} · ${d.brand}` },
      { label: "Placa", value: (d) => h("span", { class: "mono" }, d.plate) },
      { label: "Fotos", num: true, value: (d) => d.photos },
      { label: "Documentos", value: (d) => d.expired_documents.length ? h("span", { class: "pill danger" }, `Vencido: ${d.expired_documents.join(", ")}`) : h("span", { class: "pill success" }, "Vigentes") },
      { label: "Estado", value: (d) => pill(APPROVAL, d.approval_status) },
      { label: filter === "PENDING" ? "Esperando desde" : "Actualizado", value: (d) => date(d.updated_at) },
    ], drivers, {
      onRow: (d) => { location.hash = `#/conductores/${d.id_driver}`; },
      empty: filter === "PENDING" ? "No hay conductores esperando revisión" : "No hay conductores aquí",
    }));
  } catch (err) {
    show(container, head, tabs, failure(err, () => renderDrivers(container)));
  }
};

const DOC_STATUS = { OK: ["Vigente", "success"], EXPIRING: ["Por vencer", "warning"], EXPIRED: ["Vencido", "danger"] };

export const renderDriver = async (container, idDriver, { refreshCounts }) => {
  const back = h("a", { href: "#/conductores", class: "btn small back" }, "← Conductores");
  show(container, back, loading());
  let d;
  try {
    d = await api("GET", `/drivers/${idDriver}`);
  } catch (err) {
    return show(container, back, failure(err, () => renderDriver(container, idDriver, { refreshCounts })));
  }
  const v = d.vehicle;
  const reload = () => { refreshCounts(); renderDriver(container, idDriver, { refreshCounts }); };

  const approve = () => ask({
    title: "Aprobar conductor",
    message: `${d.name} podrá ponerse disponible y recibir fletes desde ya. Le llega un aviso al celular.`,
    confirm: "Aprobar", tone: "success",
    action: () => api("PUT", `/drivers/${idDriver}/approve`),
  }).then((ok) => { if (ok) { toast("Conductor aprobado", "success"); reload(); } });

  const reject = () => ask({
    title: "Rechazar vehículo",
    message: "El conductor ve este motivo en la app. Cuando corrija los datos, vuelve a esta lista.",
    confirm: "Rechazar", tone: "danger",
    field: { label: "Qué debe corregir", placeholder: "Por ejemplo: la foto no deja ver la placa", multiline: true },
    action: (note) => api("PUT", `/drivers/${idDriver}/reject`, { note }),
  }).then((ok) => { if (ok) { toast("Se le avisó al conductor"); reload(); } });

  const expired = d.documents.some((doc) => doc.status === "EXPIRED");

  show(container, 
    back,
    pageHead(d.name, `${VEHICLES[v.vehicle_type] ?? v.vehicle_type} · placa ${v.plate}`,
      pill(APPROVAL, v.approval_status),
      v.approval_status !== "APPROVED" ? h("button", { class: "btn success", onClick: approve }, "Aprobar") : null,
      v.approval_status !== "REJECTED" ? h("button", { class: "btn danger", onClick: reject }, "Rechazar") : null),

    expired ? h("div", { class: "card", style: { borderColor: "var(--danger)" } },
      h("p", { class: "error" }, "Tiene un documento vencido: aunque lo apruebes, no recibe fletes hasta que lo renueve en la app.")) : null,
    v.approval_status === "REJECTED" && v.approval_note ? h("div", { class: "card" }, h("p", {}, h("strong", {}, "Motivo del rechazo: "), v.approval_note)) : null,

    h("div", { class: "grid" },
      h("section", { class: "card" }, h("h2", {}, "Vehículo"), facts([
        ["Tipo", VEHICLES[v.vehicle_type] ?? v.vehicle_type],
        ["Marca y modelo", `${v.brand}${v.model_year ? ` ${v.model_year}` : ""}`],
        ["Color", v.color],
        ["Placa", h("span", { class: "mono" }, v.plate)],
        ["Carrocería", v.is_covered ? "Cerrada" : "Abierta"],
        ["Capacidad declarada", v.capacity_kg || v.capacity_m3 ? `${v.capacity_kg ?? "—"} kg · ${v.capacity_m3 ?? "—"} m³` : "La típica del tipo"],
        ["Tarjeta de propiedad", v.property_card_number],
      ])),
      h("section", { class: "card" }, h("h2", {}, "Documentos"), facts([
        ["Licencia", `${v.license_number ?? "—"} · categoría ${v.license_category ?? "—"}`],
        ...d.documents.map((doc) => [doc.label, h("span", { class: "row" }, date(doc.expires_at).split(",")[0], pill(DOC_STATUS, doc.status))]),
      ])),
      h("section", { class: "card" }, h("h2", {}, "Cuenta"), facts([
        ["Correo", d.email],
        ["Celular", d.phone],
        ["Registrado", date(d.registered_at)],
        ["Estado de la cuenta", pill(ACCOUNT, d.account_status)],
        ["Revisado", date(v.reviewed_at)],
      ]), h("a", { href: `#/usuarios/${idDriver}` }, "Ver la cuenta y sus viajes")),
    ),

    h("section", { class: "card" },
      h("h2", {}, `Fotos del vehículo (${d.photos.length})`),
      d.photos.length
        ? h("div", { class: "photos" }, d.photos.map((p) => h("a", { href: p.url, target: "_blank", rel: "noopener" },
            h("img", { src: p.url, alt: `Foto del vehículo placa ${v.plate}`, loading: "lazy" }))))
        : h("p", { class: "muted" }, "No ha subido fotos. Puedes rechazar pidiéndole que suba fotos donde se vea la placa.")),
  );
};
