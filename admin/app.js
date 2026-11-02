// Panel de administración de FleteYa. Página única con rutas por "#": #/inicio, #/conductores/12, #/viajes...
import { api, h, setUnauthorizedHandler, toast } from "./ui.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderDrivers, renderDriver } from "./views/drivers.js";
import { renderUsers, renderUser } from "./views/users.js";
import { renderTrips, renderTrip } from "./views/trips.js";
import { renderMoney } from "./views/money.js";
import { renderIncidents, renderIncident } from "./views/incidents.js";
import { renderRates } from "./views/rates.js";
import { renderAudit } from "./views/audit.js";

const root = document.getElementById("app");
let admin = null;

const SECTIONS = [
  { path: "inicio", label: "Inicio", list: renderDashboard },
  { path: "conductores", label: "Conductores", list: renderDrivers, detail: renderDriver, badge: "drivers" },
  { path: "usuarios", label: "Usuarios", list: renderUsers, detail: renderUser },
  { path: "viajes", label: "Viajes", list: renderTrips, detail: renderTrip },
  { path: "pagos", label: "Pagos y comisiones", list: renderMoney },
  { path: "incidentes", label: "Incidentes", list: renderIncidents, detail: renderIncident, badge: "incidents" },
  { path: "tarifas", label: "Tarifas", list: renderRates },
  { path: "registro", label: "Registro de acciones", list: renderAudit },
];

const brand = () => h("div", { class: "brand" },
  h("img", { src: "favicon.svg", alt: "", width: 40, height: 40 }),
  h("span", {}, "Flete", h("b", {}, "Ya"), h("small", {}, "Panel")));

// ---------- Entrar ----------

const renderLogin = (notice) => {
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const error = h("p", { class: "error", hidden: !notice }, notice ?? "");
  const submit = h("button", { class: "btn primary", type: "submit" }, "Entrar");
  const form = h("form", {},
    brand(),
    h("p", {}, "Solo para el equipo de FleteYa. Entra con una cuenta que tenga el rol de administrador."),
    h("label", {}, "Correo", email),
    h("label", {}, "Contraseña", password),
    error,
    submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      admin = await api("POST", "/login", { email: email.value, password: password.value });
      if (!location.hash || location.hash === "#/") location.hash = "#/inicio";
      route();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
  root.replaceChildren(h("main", { class: "login" }, form));
  email.focus();
};

const logout = async () => {
  await api("POST", "/logout").catch(() => {});
  admin = null;
  renderLogin();
};

// La sesión venció (dura 8 horas) o le quitaron el rol: vuelve a la entrada con el motivo
setUnauthorizedHandler((message) => {
  admin = null;
  renderLogin(message);
});

// ---------- Menú y contenido ----------

let counts = { drivers: 0, incidents: 0 };

// Cuántos conductores esperan revisión y cuántos incidentes siguen abiertos: se ven en el menú
const refreshCounts = async () => {
  try {
    const [drivers, incidents] = await Promise.all([api("GET", "/drivers?approval=PENDING"), api("GET", "/incidents?status=OPEN")]);
    counts = { drivers: drivers.length, incidents: incidents.length };
    document.querySelectorAll("[data-badge]").forEach((node) => {
      const value = counts[node.dataset.badge];
      node.textContent = String(value);
      node.hidden = value === 0;
    });
  } catch { /* el menú sigue sin contadores */ }
};

const shell = (current, content) => h("div", { class: "shell" },
  h("aside", { class: "side" },
    brand(),
    h("nav", { "aria-label": "Secciones" },
      SECTIONS.map((section) => h("a", {
        href: `#/${section.path}`,
        "aria-current": section.path === current ? "page" : undefined,
      }, section.label, section.badge
        ? h("span", { class: "count", "data-badge": section.badge, hidden: counts[section.badge] === 0, "aria-label": "pendientes" }, String(counts[section.badge]))
        : null))),
    h("div", { class: "who" },
      h("span", {}, admin?.name ?? ""),
      h("span", {}, admin?.email ?? ""),
      h("button", { class: "btn small", onClick: logout }, "Salir"))),
  h("main", { class: "main", id: "content" }, content));

const route = async () => {
  if (!admin) {
    try { admin = await api("GET", "/me"); } catch { return renderLogin(); }
  }
  const [, path = "inicio", id] = location.hash.split("/");
  const section = SECTIONS.find((s) => s.path === path) ?? SECTIONS[0];
  const view = id && section.detail ? section.detail : section.list;
  const container = h("div", { class: "stack", style: { gap: "20px" } });
  root.replaceChildren(shell(section.path, container));
  document.title = `${section.label} · FleteYa Panel`;
  refreshCounts();
  await view(container, id ? Number(id) : undefined, { refreshCounts });
};

window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (event) => toast(event.reason?.message ?? "Algo salió mal", "error"));
route();
