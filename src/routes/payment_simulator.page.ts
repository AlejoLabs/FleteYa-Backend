import { TEST_BANKS, type SimulatorMethod } from "../utils/simulatorTestData.js";

// Páginas del simulador de pagos: checkout con tarjeta, Nequi y PSE, "procesando" y comprobante.
// Se abren en el navegador del teléfono, así que todo va en línea (sin archivos ni librerías externas)

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pesos = (cents: number) => `$${Math.round(cents / 100).toLocaleString("es-CO")}`;

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #EEF1F4; color: #1B2430; }
  .demo { background: #FFC21A; text-align: center; padding: 8px 16px; font-size: 13px; font-weight: 600; }
  header { background: #1B2430; color: #fff; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
  header b { font-size: 17px; } header span { font-size: 12px; background: rgba(255,255,255,.14); padding: 3px 8px; border-radius: 99px; }
  main { max-width: 440px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; }
  .card { background: #fff; border-radius: 14px; padding: 18px; display: grid; gap: 12px; }
  .muted { color: #66707D; font-size: 14px; margin: 0; }
  .amount { font-size: 34px; font-weight: 800; margin: 0; }
  .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #E2E6EB; padding: 4px; border-radius: 12px; }
  .tabs button { border: 0; background: transparent; padding: 10px 4px; border-radius: 9px; font-weight: 700; font-size: 14px; color: #1B2430; }
  .tabs button[aria-selected="true"] { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  form[hidden] { display: none; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
  input, select { width: 100%; font: inherit; font-size: 16px; padding: 12px; border: 1px solid #C9D0D8; border-radius: 10px; background: #fff; color: #1B2430; }
  input:focus, select:focus { outline: 2px solid #1B2430; border-color: transparent; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pay { width: 100%; border: 0; border-radius: 12px; padding: 15px; font-size: 16px; font-weight: 800; background: #1B2430; color: #fff; }
  .error { background: #FBE3E0; color: #B3261E; border-radius: 10px; padding: 10px 12px; font-size: 14px; font-weight: 600; }
  details { font-size: 14px; } summary { font-weight: 700; cursor: pointer; }
  details ul { padding-left: 18px; margin: 8px 0 0; display: grid; gap: 4px; }
  code { background: #EEF1F4; padding: 1px 5px; border-radius: 5px; }
  .center { text-align: center; justify-items: center; }
  .spinner { width: 48px; height: 48px; border-radius: 50%; border: 5px solid #E2E6EB; border-top-color: #1B2430; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .badge { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 34px; font-weight: 800; }
  .ok { background: #17804F; } .bad { background: #B3261E; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 14px; text-align: left; width: 100%; }
  dt { color: #66707D; } dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
`;

const layout = (body: string, head = "") => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pasarela de prueba · FleteYa</title>${head}<style>${STYLE}</style></head><body>
<div class="demo">Modo de prueba: no se cobra dinero real. No escribas datos reales.</div>
<header><b>FleteYa · Pagos</b><span>PRUEBA</span></header>
<main>${body}</main></body></html>`;

const TEST_DATA = `<details class="card"><summary>Datos de prueba</summary><ul>
  <li>Tarjeta aprobada: <code>4242 4242 4242 4242</code></li>
  <li>Tarjeta rechazada: <code>4111 1111 1111 1111</code></li>
  <li>Con cualquier fecha futura, CVC de 3 dígitos y nombre</li>
  <li>Nequi aprobado: <code>3991111111</code> · rechazado: <code>3992222222</code></li>
  <li>PSE: elige el banco que aprueba o el que rechaza</li>
</ul></details>`;

const METHOD_TABS: { method: SimulatorMethod; label: string }[] = [
    { method: "CARD", label: "Tarjeta" },
    { method: "NEQUI", label: "Nequi" },
    { method: "PSE", label: "PSE" },
];

interface CheckoutOptions {
    reference: string;
    amountCents: number;
    active?: SimulatorMethod;
    error?: string;
}

export const checkoutPage = ({ reference, amountCents, active = "CARD", error }: CheckoutOptions) => {
    const amount = pesos(amountCents);
    const tabs = METHOD_TABS.map(({ method, label }) =>
        `<button type="button" role="tab" data-tab="${method}" aria-selected="${method === active}">${label}</button>`).join("");
    const hidden = (method: SimulatorMethod) => method === active ? "" : "hidden";
    const banks = TEST_BANKS.map((bank) => `<option value="${bank.code}">${escapeHtml(bank.name)}</option>`).join("");
    const installments = Array.from({ length: 36 }, (_, i) => `<option>${i + 1}</option>`).join("");
    // autocomplete="off" en todo: el navegador no debe guardar ni sugerir datos de tarjeta en una página de prueba
    return layout(`
<div class="card">
  <p class="muted">Pago del flete · ${escapeHtml(reference)}</p>
  <p class="amount">${amount}</p>
</div>
${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}
<div class="tabs" role="tablist">${tabs}</div>

<form method="post" class="card" data-panel="CARD" ${hidden("CARD")} autocomplete="off">
  <input type="hidden" name="method" value="CARD">
  <label>Número de la tarjeta<input name="card_number" inputmode="numeric" placeholder="4242 4242 4242 4242" maxlength="23" autocomplete="off" required></label>
  <div class="row">
    <label>Vence<input name="expiry" inputmode="numeric" placeholder="MM/AA" maxlength="5" autocomplete="off" required></label>
    <label>CVC<input name="cvc" inputmode="numeric" placeholder="123" maxlength="4" autocomplete="off" required></label>
  </div>
  <label>Nombre en la tarjeta<input name="holder" placeholder="Como aparece en la tarjeta" autocomplete="off" required></label>
  <label>Cuotas<select name="installments">${installments}</select></label>
  <button class="pay">Pagar ${amount}</button>
</form>

<form method="post" class="card" data-panel="NEQUI" ${hidden("NEQUI")} autocomplete="off">
  <input type="hidden" name="method" value="NEQUI">
  <label>Celular de tu cuenta Nequi<input name="phone" inputmode="numeric" placeholder="3991111111" maxlength="10" autocomplete="off" required></label>
  <p class="muted">Te enviamos una notificación a la app de Nequi para que aceptes el pago.</p>
  <button class="pay">Pagar ${amount} con Nequi</button>
</form>

<form method="post" class="card" data-panel="PSE" ${hidden("PSE")} autocomplete="off">
  <input type="hidden" name="method" value="PSE">
  <label>Tipo de persona<select name="person_type"><option value="NATURAL">Natural</option><option value="JURIDICA">Jurídica</option></select></label>
  <label>Banco<select name="bank" required><option value="">Elige tu banco</option>${banks}</select></label>
  <div class="row">
    <label>Documento<select name="document_type"><option>CC</option><option>CE</option><option>NIT</option></select></label>
    <label>Número<input name="document" inputmode="numeric" placeholder="1023456789" maxlength="15" autocomplete="off" required></label>
  </div>
  <button class="pay">Ir al banco y pagar ${amount}</button>
</form>
${TEST_DATA}
<script>
  document.querySelectorAll('[data-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('[data-tab]').forEach(function (t) { t.setAttribute('aria-selected', t === tab); });
      document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });
  var number = document.querySelector('[name=card_number]');
  number.addEventListener('input', function () { number.value = number.value.replace(/\\D/g, '').replace(/(\\d{4})(?=\\d)/g, '$1 '); });
  var expiry = document.querySelector('[name=expiry]');
  expiry.addEventListener('input', function () { var v = expiry.value.replace(/\\D/g, ''); expiry.value = v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2, 4) : v; });
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () { form.querySelector('.pay').disabled = true; });
  });
</script>`);
}

const PROCESSING_TEXT: Record<SimulatorMethod, string> = {
    CARD: "Validando tu tarjeta con el banco…",
    NEQUI: "Te enviamos una notificación a tu Nequi. En la prueba se acepta sola.",
    PSE: "Conectando con tu banco…",
};

// Se recarga sola hasta que el pago queda aprobado o rechazado
export const processingPage = (method: SimulatorMethod) => layout(`
<div class="card center">
  <div class="spinner" role="status" aria-label="Procesando"></div>
  <h2 style="margin:0">Procesando el pago</h2>
  <p class="muted">${PROCESSING_TEXT[method]}</p>
  <p class="muted">No cierres esta página.</p>
</div>`, `<meta http-equiv="refresh" content="2">`);

interface ResultOptions {
    approved: boolean;
    reference: string;
    transactionId: string;
    description: string;
    amountCents: number;
}

export const resultPage = ({ approved, reference, transactionId, description, amountCents }: ResultOptions) => layout(`
<div class="card center">
  <div class="badge ${approved ? "ok" : "bad"}" aria-hidden="true">${approved ? "✓" : "✕"}</div>
  <h2 style="margin:0">${approved ? "Pago aprobado" : "Pago rechazado"}</h2>
  <p class="muted">${approved ? "Ya puedes volver a FleteYa: el pago se confirma solo." : "Vuelve a FleteYa para intentar otra vez o pagar en efectivo."}</p>
  <dl>
    <dt>Valor</dt><dd>${pesos(amountCents)}</dd>
    <dt>Medio</dt><dd>${escapeHtml(description)}</dd>
    <dt>Referencia</dt><dd>${escapeHtml(reference)}</dd>
    <dt>Transacción</dt><dd>${escapeHtml(transactionId)}</dd>
  </dl>
</div>`);

export const messagePage = (title: string, text: string) => layout(`
<div class="card"><h2 style="margin:0">${escapeHtml(title)}</h2><p class="muted">${escapeHtml(text)}</p></div>`);
