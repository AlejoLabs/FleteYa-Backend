// Registro de acciones del panel: quién hizo qué, sobre qué y cuándo
import { api, date, failure, h, loading, pageHead, pager, table, show } from "../ui.js";

const ACTIONS = {
  LOGIN: "Entró al panel", SUSPEND_USER: "Suspendió una cuenta", REACTIVATE_USER: "Reactivó una cuenta",
  ANONYMIZE_USER: "Borró datos personales", APPROVE_DRIVER: "Aprobó un conductor", REJECT_DRIVER: "Rechazó un conductor",
  CANCEL_TRIP: "Cerró un viaje", SETTLE_COMMISSION: "Liquidó comisión", UPDATE_INCIDENT: "Cambió un incidente",
  UPDATE_RATES: "Cambió las tarifas",
};
const LINKS = { user: "usuarios", driver: "conductores", trip: "viajes", incident: "incidentes" };

let page = 1;

export const renderAudit = async (container) => {
  const head = pageHead("Registro de acciones", "Cada cambio hecho desde el panel queda aquí y no se puede borrar.");
  show(container, head, loading());
  try {
    const result = await api("GET", `/audit?page=${page}`);
    show(container, head,
      table([
        { label: "Fecha", value: (a) => date(a.created_at) },
        { label: "Quién", value: (a) => h("div", { class: "stack", style: { gap: "0" } }, h("span", {}, a.admin), h("span", { class: "muted small" }, a.admin_email)) },
        { label: "Qué hizo", value: (a) => ACTIONS[a.action] ?? a.action },
        { label: "Sobre", value: (a) => (LINKS[a.target_type] && a.target_id ? h("a", { href: `#/${LINKS[a.target_type]}/${a.target_id}` }, `#${a.target_id}`) : "—") },
        { label: "Detalle", value: (a) => a.detail ?? "" },
      ], result.items, { empty: "Todavía no hay acciones" }),
      pager(result, (next) => { page = next; renderAudit(container); }));
  } catch (err) {
    show(container, head, failure(err, () => renderAudit(container)));
  }
};
