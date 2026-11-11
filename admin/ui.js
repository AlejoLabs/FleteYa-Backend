// Utilidades del panel. Los datos (nombres, direcciones, descripciones) se escriben siempre como texto con h():
// nunca se arma HTML con ellos, así un nombre como "<script>" se ve tal cual y no se ejecuta

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
};

// Pone el contenido de una vista. A diferencia de replaceChildren, omite los null (las partes que no aplican):
// el navegador los escribiría como el texto "null"
export const show = (container, ...nodes) =>
  container.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler) => { onUnauthorized = handler; };

// Todo lo que cambia datos lleva X-FleteYa-Admin: el servidor lo exige para que otro sitio no pueda mandar el cambio
export const api = async (method, path, body) => {
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(method !== "GET" ? { "X-FleteYa-Admin": "1" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(". ") : (data?.message ?? "No se pudo completar la acción");
    if (res.status === 401 && path !== "/login") onUnauthorized(message);
    throw new ApiError(res.status, message);
  }
  return data;
};

// ---------- Formatos (como en la app: pesos colombianos y fechas en hora de Colombia) ----------

// Un monto en su moneda, con el formato de Colombia: "$ 25.000" (COP), "EUR 30,50", "US$ 27". Los enteros van sin
// ",00". Sin moneda (datos de antes de la Fase 9b) es en pesos colombianos. El panel nunca suma monedas distintas
const formats = new Map();
const formatFor = (currency, decimals) => {
  const key = `${currency}-${decimals}`;
  if (!formats.has(key)) formats.set(key, new Intl.NumberFormat("es-CO", { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  return formats.get(key);
};
export const money = (value, currency = "COP") => {
  const amount = Math.round(Number(value ?? 0) * 100) / 100;
  const whole = Number.isInteger(amount) || currency === "COP";
  return formatFor(currency, whole ? 0 : 2).format(currency === "COP" ? Math.round(amount) : amount);
};
// Varios montos de monedas distintas, uno al lado del otro: "$ 120.000 · EUR 45,30"
export const moneyList = (rows, field) =>
  rows.length ? rows.map((row) => money(row[field], row.currency)).join(" · ") : money(0);
export const number = (value) => new Intl.NumberFormat("es-CO").format(Number(value ?? 0));
const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
const dayFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });
export const date = (value) => (value ? dateFmt.format(new Date(value)) : "—");
export const day = (value) => (value ? dayFmt.format(new Date(value)) : "—");
export const percent = (fraction) => `${(Number(fraction) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;

export const VEHICLES = { CARRY: "Carry", ESTACAS: "Estacas", FURGON: "Furgón", CAMION: "Camión" };
export const ROLES = { CLIENT: "Cliente", DRIVER: "Conductor", ADMIN: "Admin" };
export const TRIP_STATUS = {
  CREATED: ["Buscando conductor", "warning"], ACCEPTED: ["Conductor asignado", "info"], ON_THE_WAY: ["En camino", "info"],
  ARRIVED: ["En la recogida", "info"], TRAVELING: ["Carga en camino", "cargo"], FINISHED: ["Entregado", "success"],
  CANCELED: ["Cancelado", "neutral"], EXPIRED: ["Vencido", "neutral"],
};
export const APPROVAL = { PENDING: ["En revisión", "warning"], APPROVED: ["Aprobado", "success"], REJECTED: ["Rechazado", "danger"] };
export const ACCOUNT = { ACTIVE: ["Activa", "success"], SUSPENDED: ["Suspendida", "danger"] };
export const PAYMENT_STATUS = { PENDING: ["Pendiente", "warning"], APPROVED: ["Aprobado", "success"], DECLINED: ["Rechazado", "danger"], VOIDED: ["Anulado", "neutral"], ERROR: ["Error", "danger"] };
export const INCIDENT_STATUS = { OPEN: ["Abierto", "danger"], IN_REVIEW: ["En revisión", "warning"], RESOLVED: ["Resuelto", "success"] };
export const INCIDENT_KIND = { DAMAGE: "Daño", LOSS: "Pérdida", DELAY: "Retraso", BEHAVIOR: "Comportamiento", OTHER: "Otro" };
export const PAYMENT_METHOD = { CASH: "Efectivo", WOMPI: "Por la app" };

// Estado con su texto, nunca solo color
export const pill = (map, key) => {
  const [label, tone] = map[key] ?? [key ?? "—", "neutral"];
  return h("span", { class: `pill ${tone}` }, label);
};

// ---------- Avisos y diálogos ----------

export const toast = (message, tone = "info") => {
  const node = h("div", { class: `msg ${tone}` }, message);
  document.getElementById("toast").append(node);
  setTimeout(() => node.remove(), 4000);
};

// Pide confirmar, y opcionalmente un texto (motivo). Devuelve el texto, true, o null si se cancela.
// La acción corre dentro del diálogo: si el servidor responde con error, se muestra ahí mismo sin cerrarlo
export const ask = ({ title, message, confirm, tone = "dark", field, action }) => new Promise((resolve) => {
  const input = field
    ? h(field.multiline ? "textarea" : "input", { name: "value", placeholder: field.placeholder ?? "", maxlength: 240, required: true })
    : null;
  const error = h("p", { class: "error", hidden: true });
  const submit = h("button", { class: `btn ${tone}`, type: "submit" }, confirm);
  const dialog = h("dialog", {},
    h("form", { method: "dialog" },
      h("h2", {}, title),
      message ? h("p", { class: "muted" }, message) : null,
      input ? h("label", {}, field.label, input) : null,
      error,
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", onClick: () => { dialog.close(); resolve(null); } }, "Volver"),
        submit,
      ),
    ),
  );
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input ? input.value.trim() : true;
    submit.disabled = true;
    error.hidden = true;
    try {
      const result = action ? await action(value) : value;
      dialog.close();
      resolve(result ?? value);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
  dialog.addEventListener("close", () => setTimeout(() => dialog.remove(), 0));
  document.body.append(dialog);
  dialog.showModal();
  (input ?? submit).focus();
});

// ---------- Piezas de página ----------

export const pageHead = (title, subtitle, ...actions) =>
  h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, title), subtitle ? h("p", { class: "muted" }, subtitle) : null),
    actions.length ? h("div", { class: "row" }, actions) : null);

export const loading = (text = "Cargando…") => h("div", { class: "loading" }, text);

export const failure = (err, retry) => h("div", { class: "card" },
  h("p", { class: "error" }, err.message ?? "No se pudo cargar"),
  retry ? h("button", { class: "btn back", onClick: retry }, "Intentar de nuevo") : null);

// Tabla: columnas { label, value(row) => texto o nodo, num? } y, si se pasa, clic en la fila
export const table = (columns, rows, { onRow, empty = "No hay nada para mostrar" } = {}) =>
  h("div", { class: "table-wrap" },
    h("table", {},
      h("thead", {}, h("tr", {}, columns.map((col) => h("th", { class: col.num ? "num" : undefined, scope: "col" }, col.label)))),
      h("tbody", {},
        rows.length === 0
          ? h("tr", {}, h("td", { colspan: columns.length, class: "empty" }, empty))
          : rows.map((row) => h("tr", {
              class: onRow ? "clickable" : undefined,
              tabindex: onRow ? 0 : undefined,
              onClick: onRow ? () => onRow(row) : undefined,
              onKeydown: onRow ? (e) => { if (e.key === "Enter") onRow(row); } : undefined,
            }, columns.map((col) => h("td", { class: col.num ? "num" : undefined }, col.value(row))))),
      ),
    ),
  );

export const pager = ({ total, page, page_size }, go) => {
  const pages = Math.max(1, Math.ceil(total / page_size));
  return h("div", { class: "pager" },
    h("span", { class: "muted small" }, `${number(total)} en total · página ${page} de ${pages}`),
    h("button", { class: "btn small", disabled: page <= 1, onClick: () => go(page - 1) }, "Anterior"),
    h("button", { class: "btn small", disabled: page >= pages, onClick: () => go(page + 1) }, "Siguiente"));
};

export const facts = (pairs) => h("dl", { class: "facts" },
  pairs.filter(Boolean).map(([label, value]) => [h("dt", {}, label), h("dd", {}, value ?? "—")]));

// Barras horizontales de una serie: etiqueta, barra y valor escrito (el valor no depende del color)
export const barList = (items, { format = number, empty = "Sin datos en este periodo" } = {}) => {
  if (!items.length) return h("p", { class: "muted" }, empty);
  const max = Math.max(...items.map((item) => item.value), 1);
  return h("div", { class: "bars", role: "list" },
    items.map((item) => h("div", { class: "bar-row", role: "listitem", title: `${item.label}: ${format(item.value)}` },
      h("span", {}, item.label),
      h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${(item.value / max) * 100}%` } })),
      h("span", { class: "v" }, format(item.value)))));
};

// Columnas por día de una serie, con tooltip al pasar o enfocar cada día y una tabla equivalente para lectores de pantalla
export const dayColumns = (points, label) => {
  if (!points.length) return h("p", { class: "muted" }, "Sin datos en este periodo");
  const max = Math.max(...points.map((p) => p.value), 1);
  return h("div", { class: "stack" },
    h("div", { class: "columns", "aria-hidden": "true" },
      points.map((p) => h("div", { class: "col", tabindex: -1 },
        h("span", { class: "tip" }, `${day(p.day)}: ${number(p.value)} ${label}`),
        h("div", { class: "fill", style: { height: `${(p.value / max) * 100}%` } })))),
    h("div", { class: "axis", "aria-hidden": "true" },
      h("span", {}, day(points[0].day)), h("span", {}, `máx. ${number(max)}`), h("span", {}, day(points[points.length - 1].day))),
    h("details", {},
      h("summary", { class: "small muted" }, "Ver como tabla"),
      table([{ label: "Día", value: (p) => day(p.day) }, { label, num: true, value: (p) => number(p.value) }], points)));
};
