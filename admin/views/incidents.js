// Incidentes reportados por clientes y conductores: revisarlos con sus fotos y marcarlos en revisión o resueltos
import { api, date, facts, failure, h, INCIDENT_KIND, INCIDENT_STATUS, loading, pageHead, pill, table, toast, TRIP_STATUS, show } from "../ui.js";

let filter = "OPEN";
const FILTERS = [["OPEN", "Abiertos"], ["IN_REVIEW", "En revisión"], ["RESOLVED", "Resueltos"], ["", "Todos"]];

export const renderIncidents = async (container) => {
  const tabs = h("div", { class: "row", role: "group", "aria-label": "Filtrar" },
    FILTERS.map(([value, label]) => h("button", {
      class: `btn small${value === filter ? " dark" : ""}`, "aria-pressed": value === filter,
      onClick: () => { filter = value; renderIncidents(container); },
    }, label)));
  const head = pageHead("Incidentes", "Daños, pérdidas y otros problemas que reportan en los viajes. Los más viejos primero.");
  show(container, head, tabs, loading());
  try {
    const rows = await api("GET", `/incidents${filter ? `?status=${filter}` : ""}`);
    show(container, head, tabs, table([
      { label: "Tipo", value: (i) => INCIDENT_KIND[i.kind] ?? i.kind },
      { label: "Qué pasó", value: (i) => i.summary },
      { label: "Reporta", value: (i) => i.reporter },
      { label: "Flete", num: true, value: (i) => `#${i.id_client_request}` },
      { label: "Fotos", num: true, value: (i) => i.photos },
      { label: "Estado", value: (i) => pill(INCIDENT_STATUS, i.status) },
      { label: "Fecha", value: (i) => date(i.created_at) },
    ], rows, { onRow: (i) => { location.hash = `#/incidentes/${i.id}`; }, empty: filter === "OPEN" ? "No hay incidentes abiertos" : "No hay incidentes aquí" }));
  } catch (err) {
    show(container, head, tabs, failure(err, () => renderIncidents(container)));
  }
};

export const renderIncident = async (container, id, { refreshCounts }) => {
  const back = h("a", { href: "#/incidentes", class: "btn small back" }, "← Incidentes");
  show(container, back, loading());
  let incident;
  try {
    incident = await api("GET", `/incidents/${id}`);
  } catch (err) {
    return show(container, back, failure(err, () => renderIncident(container, id, { refreshCounts })));
  }
  const setStatus = async (status) => {
    try {
      await api("PUT", `/incidents/${id}`, { status });
      toast(status === "RESOLVED" ? "Marcado como resuelto" : "Marcado en revisión", "success");
      refreshCounts();
      renderIncident(container, id, { refreshCounts });
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const trip = incident.trip;
  show(container, 
    back,
    pageHead(`${INCIDENT_KIND[incident.kind] ?? incident.kind} en el flete #${trip.id}`, `Reportado el ${date(incident.created_at)}`,
      pill(INCIDENT_STATUS, incident.status),
      incident.status === "OPEN" ? h("button", { class: "btn", onClick: () => setStatus("IN_REVIEW") }, "Marcar en revisión") : null,
      incident.status !== "RESOLVED" ? h("button", { class: "btn success", onClick: () => setStatus("RESOLVED") }, "Marcar resuelto") : null,
      incident.status === "RESOLVED" ? h("button", { class: "btn", onClick: () => setStatus("IN_REVIEW") }, "Reabrir") : null),
    h("div", { class: "grid" },
      h("section", { class: "card" }, h("h2", {}, "Lo que reportó"), h("p", { style: { whiteSpace: "pre-wrap" } }, incident.description)),
      h("section", { class: "card" }, h("h2", {}, "Datos"), facts([
        ["Reporta", h("a", { href: `#/usuarios/${incident.reporter.id}` }, incident.reporter.name)],
        ["Como", incident.reporter_role === "CLIENT" ? "Cliente" : "Conductor"],
        ["Correo", incident.reporter.email],
        ["Flete", h("a", { href: `#/viajes/${trip.id}` }, `#${trip.id}`)],
        ["Estado del flete", pill(TRIP_STATUS, trip.status)],
        ["Ruta", `${trip.pickup_description} → ${trip.destination_description}`],
      ])),
    ),
    h("section", { class: "card" },
      h("h2", {}, `Fotos (${incident.photos.length})`),
      incident.photos.length
        ? h("div", { class: "photos" }, incident.photos.map((p) => h("a", { href: p.url, target: "_blank", rel: "noopener" },
            h("img", { src: p.url, alt: "Foto del incidente", loading: "lazy" }))))
        : h("p", { class: "muted" }, "Sin fotos")),
  );
};
