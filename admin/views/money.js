// Pagos y comisiones: lo que cada conductor debe de sus viajes en efectivo y todos los intentos de pago por la app
import { api, ask, date, failure, h, loading, money, number, pageHead, pager, PAYMENT_METHOD, PAYMENT_STATUS, pill, table, toast, show } from "../ui.js";

let page = 1;

export const renderMoney = async (container) => {
  const head = pageHead("Pagos y comisiones",
    "Por la app, FleteYa recibe el pago y retiene la comisión. En efectivo, el conductor cobra todo y le debe la comisión a FleteYa.");
  show(container, head, loading());
  let owed, payments;
  try {
    [owed, payments] = await Promise.all([api("GET", "/commissions"), api("GET", `/payments?page=${page}`)]);
  } catch (err) {
    return show(container, head, failure(err, () => renderMoney(container)));
  }

  const settle = (row) => ask({
    title: "Liquidar comisión",
    message: `Confirma que ${row.name} le entregó a FleteYa ${money(row.owed)} por ${number(row.trips)} ${row.trips === 1 ? "viaje" : "viajes"} en efectivo.`,
    confirm: `Recibí ${money(row.owed)}`, tone: "success",
    action: () => api("POST", `/commissions/${row.id_driver}/settle`),
  }).then((ok) => { if (ok) { toast("Comisión liquidada", "success"); renderMoney(container); } });

  const total = owed.reduce((sum, row) => sum + row.owed, 0);
  show(container, 
    head,
    h("section", { class: "stack" },
      h("div", { class: "spread" }, h("h2", {}, "Comisión en efectivo por cobrar"), h("strong", { class: "mono" }, money(total))),
      table([
        { label: "Conductor", value: (r) => h("a", { href: `#/usuarios/${r.id_driver}`, onClick: (e) => e.stopPropagation() }, r.name) },
        { label: "Viajes", num: true, value: (r) => number(r.trips) },
        { label: "Cobró a clientes", num: true, value: (r) => money(r.collected) },
        { label: "Debe a FleteYa", num: true, value: (r) => h("strong", {}, money(r.owed)) },
        { label: "Desde", value: (r) => date(r.oldest) },
        { label: "", value: (r) => h("button", { class: "btn small success", onClick: () => settle(r) }, "Liquidar") },
      ], owed, { empty: "Ningún conductor debe comisiones" })),
    h("section", { class: "stack" },
      h("h2", {}, "Pagos registrados"),
      table([
        { label: "Referencia", value: (p) => h("span", { class: "mono" }, p.reference) },
        { label: "Flete", num: true, value: (p) => h("a", { href: `#/viajes/${p.id_client_request}` }, `#${p.id_client_request}`) },
        { label: "Cliente", value: (p) => p.client },
        // En la app: Nequi, tarjeta o PSE; en efectivo lo confirma el conductor
        { label: "Medio", value: (p) => p.channel ?? PAYMENT_METHOD[p.method] ?? "—" },
        { label: "Monto", num: true, value: (p) => money(p.amount) },
        { label: "Comisión", num: true, value: (p) => (p.commission ? money(p.commission) : "—") },
        { label: "Estado", value: (p) => pill(PAYMENT_STATUS, p.status) },
        { label: "Fecha", value: (p) => date(p.created_at) },
      ], payments.items, { empty: "Todavía no hay pagos por la app" }),
      pager(payments, (next) => { page = next; renderMoney(container); })),
  );
};
