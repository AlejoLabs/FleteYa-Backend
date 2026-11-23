// Fase 11: impuesto, propina y comprobante por país. El impuesto sale del perfil del país (country_tax_profiles) y se
// calcula sobre la comisión de FleteYa; la propina va al conductor y se suma al total; el comprobante lee lo que se fijó
// al pagar. Uso: npm test. El pago por la app usa el simulador (PAYMENTS_SIMULATOR=true y sin llaves de Wompi)
import { API, call, connectSocket, createReport, dbHelper, testClient, testDriver, uploadPhoto, wait } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();

const stamp = Date.now();
const STRANGER_EMAIL = `ajeno-comprobante${stamp}@prueba.com`;
const stranger = await call("POST", "/auth/register", null, { name: "Usuario", lastname: "Ajeno", email: STRANGER_EMAIL, phone: "3009998877", password: "123456" });
const STRANGER = { token: stranger.data?.token };

// Puntos de prueba [lat, lng, destLat, destLng]
const BOGOTA = [4.61, -74.19, 4.62, -74.14];
const NUEVA_YORK = [40.7128, -74.006, 40.7306, -73.9866];
const PARIS = [48.8566, 2.3522, 48.8738, 2.295];
const BERLIN = [52.52, 13.405, 52.5, 13.38];

const status = (id, s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id, status: s });
const photo = (id, kind) => uploadPhoto(`/client-requests/${id}/photos`, DRIVER.token, { kind });
const payment = (id, token = CLIENT.token) => call("GET", `/client-requests/${id}/payment`, token);
const receipt = (id, token = CLIENT.token) => call("GET", `/client-requests/${id}/receipt`, token);
const setTip = (id, tip, token = CLIENT.token) => call("PUT", `/client-requests/${id}/payment/tip`, token, { tip });
const cash = (id, body) => call("POST", `/client-requests/${id}/payment/cash`, DRIVER.token, body);
const startOnline = (id, body) => call("POST", `/client-requests/${id}/payment/online`, CLIENT.token, body);
const line = (r, type) => r.data?.lines?.find((item) => item.type === type);

// Lleva un flete nuevo hasta entregado, con el precio acordado indicado, en el país del punto de recogida
const deliveredTrip = async ([lat, lng, destLat, destLng], fare, extra = {}) => {
    const body = { pickup_lat: lat, pickup_lng: lng, destination_lat: destLat, destination_lng: destLng, fare_offered: fare,
        pickup_description: "Prueba Fase 11 origen", destination_description: "Prueba Fase 11 destino", cargo_description: "Prueba Fase 11",
        weight_kg: 30, length_cm: 60, width_cm: 40, height_cm: 40, no_prohibited_items: true, ...extra };
    const id = (await call("POST", "/client-requests", CLIENT.token, body)).data;
    await call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: fare, time: 5, distance: 1 });
    await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id, id_driver_assigned: DRIVER.id });
    await status(id, "ON_THE_WAY");
    await status(id, "ARRIVED");
    await photo(id, "PICKUP");
    await status(id, "TRAVELING");
    await photo(id, "DELIVERY");
    const { delivery_code } = (await call("GET", `/client-requests/${id}`, CLIENT.token)).data;
    await call("POST", `/client-requests/${id}/deliver`, DRIVER.token, { code: delivery_code });
    return id;
};

// 1. Los perfiles de los países llegan en la lista pública de países
const countries = (await call("GET", "/countries")).data ?? [];
const byCode = Object.fromEntries(countries.map((c) => [c.code, c]));
const expected = {
    CO: ["IVA", 0.19, "FACTURA_ELECTRONICA", "NIT", "OPTIONAL"], BR: ["ISS", 0.05, "NFSE", "CNPJ", "OPTIONAL"],
    US: ["Sales tax", 0.08875, "RECEIPT", "EIN", "SUGGESTED"], FR: ["TVA", 0.2, "FACTURE", "SIRET", "NONE"],
    DE: ["MwSt.", 0.19, "RECHNUNG", "USt-IdNr.", "OPTIONAL"],
};
for (const [code, [name, rate, type, idLabel, mode]] of Object.entries(expected)) {
    const c = byCode[code];
    check(`${code}: ${name} ${(rate * 100).toFixed(3).replace(/\.?0+$/, "")} %, ${type}, ${idLabel}, propina ${mode}`,
        c?.tax_name === name && c.tax_rate === rate && c.receipt_type === type && c.tax_id_label === idLabel && c.tip_mode === mode,
        JSON.stringify(c && { n: c.tax_name, r: c.tax_rate, t: c.receipt_type, i: c.tax_id_label, m: c.tip_mode }));
}
check("Estados Unidos sugiere 15, 18 y 20 %", JSON.stringify(byCode.US?.tip_suggestions) === "[15,18,20]");
const others = { MX: 0.16, EC: 0.15, PA: 0.07, SV: 0.13, PR: 0.115, ES: 0.21, IT: 0.22, PT: 0.23, AT: 0.2, BE: 0.21, LU: 0.17, IE: 0.23, MT: 0.18, MC: 0.2, AD: 0.045, SM: 0, AU: 0.1, IN: 0.18, ZA: 0.15 };
check("Los otros 19 países tienen su impuesto de referencia y comprobante genérico",
    Object.entries(others).every(([code, rate]) => byCode[code]?.tax_rate === rate && byCode[code].receipt_type === "GENERIC"),
    Object.entries(others).filter(([code, rate]) => byCode[code]?.tax_rate !== rate).map(([code]) => code).join());
check("Los 24 países traen perfil y modo de propina válido", countries.length === 24 && countries.every((c) => c.tax_name && ["NONE", "OPTIONAL", "SUGGESTED"].includes(c.tip_mode)));

// 2. Colombia en efectivo, sin propina: IVA 19 % sobre la comisión (10 % de 30.000 = 3.000 → 570)
const co = await deliveredTrip(BOGOTA, 30000);
const coStatus = (await payment(co)).data;
check("Antes de pagar el estado trae el modo de propina del país (CO opcional) y el total",
    coStatus?.tip_mode === "OPTIONAL" && coStatus.tip === 0 && coStatus.total === 30000 && coStatus.max_tip === 30000, JSON.stringify(coStatus));
check("Sin pagar no hay comprobante: 409", (await receipt(co)).status === 409);
check("Comprobante de un flete que no existe: 404", (await receipt(999999999)).status === 404);
check("El conductor confirma el efectivo", (await cash(co)).status === 200);
const coReceipt = await receipt(co);
check("Comprobante CO: factura electrónica en COP",
    coReceipt.status === 200 && coReceipt.data?.receipt_type === "FACTURA_ELECTRONICA" && coReceipt.data.currency === "COP" && coReceipt.data.country_code === "CO", JSON.stringify(coReceipt.data));
check("IVA = 19 % de la comisión de 3.000 = 570",
    line(coReceipt, "COMMISSION")?.amount === 3000 && line(coReceipt, "TAX")?.amount === 570 && line(coReceipt, "TAX")?.rate === 0.19 && line(coReceipt, "TAX")?.name === "IVA", JSON.stringify(coReceipt.data?.lines));
check("Transporte 30.000, sin propina, total 30.000", line(coReceipt, "TRANSPORT")?.amount === 30000 && line(coReceipt, "TIP")?.amount === 0 && coReceipt.data?.total === 30000);
check("La comisión y el impuesto vienen incluidos: no se suman al total",
    line(coReceipt, "COMMISSION")?.included === true && line(coReceipt, "TAX")?.included === true && line(coReceipt, "TRANSPORT")?.included === false);
check("Número de comprobante FY-CO-año-id, fecha en UTC y datos del viaje",
    new RegExp(`^FY-CO-\\d{4}-0*${co}$`).test(coReceipt.data?.receipt_number) && /^\d{4}-\d\d-\d\dT.*Z$/.test(coReceipt.data?.issued_at)
    && coReceipt.data.pickup_description === "Prueba Fase 11 origen" && coReceipt.data.destination_description === "Prueba Fase 11 destino"
    && typeof coReceipt.data.driver === "string" && coReceipt.data.tax_id_label === "NIT", JSON.stringify(coReceipt.data));
check("El conductor del flete también ve el comprobante", (await receipt(co, DRIVER.token)).data?.total === 30000);
check("Un tercero no ve el comprobante: 403", (await receipt(co, STRANGER.token)).status === 403);
check("Sin sesión: 401", (await receipt(co, null)).status === 401);
check("Pagado: ya no se cambia la propina (409)", (await setTip(co, 1000)).status === 409);

// 3. Propina opcional en Colombia, por la app: el cobro es precio + propina y la comisión sigue siendo sobre el precio
const coOnline = await deliveredTrip(BOGOTA, 30000);
check("Propina negativa: 400", (await startOnline(coOnline, { tip: -500 })).status === 400);
check("Propina que no es número: 400", (await startOnline(coOnline, { tip: "mucha" })).status === 400);
const tooMuch = await startOnline(coOnline, { tip: 30001 });
check("Propina mayor que el flete: 400 TIP_TOO_HIGH", tooMuch.status === 400 && tooMuch.data?.key === "TIP_TOO_HIGH", `${tooMuch.status} ${tooMuch.data?.key}`);
const started = await startOnline(coOnline, { tip: 2000.4 });
check("El checkout cobra 32.000 (30.000 + propina de 2.000 sin centavos)", started.status === 201 && started.data?.amount === 32000 && started.data.tip === 2000, JSON.stringify(started.data));
const afterStart = (await payment(coOnline)).data;
check("El estado muestra propina 2.000 y total 32.000, con el valor acordado aparte", afterStart?.tip === 2000 && afterStart.total === 32000 && afterStart.amount === 30000, JSON.stringify(afterStart));
await fetch(started.data.checkout_url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ method: "CARD", card_number: "4242424242424242", expiry: "12/39", cvc: "123", holder: "Prueba Fase Once" }).toString(),
});
await wait(3000);
const verified = await call("POST", `/client-requests/${coOnline}/payment/online/verify`, CLIENT.token);
check("Pagado por la app con la propina", verified.data?.paid_at && verified.data.last_payment?.status === "APPROVED" && verified.data.last_payment.amount === 32000, JSON.stringify(verified.data?.last_payment));
const onlineReceipt = await receipt(coOnline);
check("Comprobante: total = precio + propina (32.000), propina 2.000",
    onlineReceipt.data?.total === 32000 && line(onlineReceipt, "TIP")?.amount === 2000 && line(onlineReceipt, "TRANSPORT")?.amount === 30000, JSON.stringify(onlineReceipt.data?.lines));
check("La propina no paga comisión ni impuesto: siguen 3.000 y 570", line(onlineReceipt, "COMMISSION")?.amount === 3000 && line(onlineReceipt, "TAX")?.amount === 570);
const driverHistory = (await call("GET", `/client-requests/driver/assigned/${DRIVER.id}`, DRIVER.token)).data?.find((t) => t.id === coOnline);
check("El historial del conductor trae la propina (100 % para él)", driverHistory?.tip === 2000 && driverHistory.commission === 3000, JSON.stringify(driverHistory && { tip: driverHistory.tip, c: driverHistory.commission }));

// 4. Propina en efectivo: el cliente la elige antes y el conductor confirma
const coCash = await deliveredTrip(BOGOTA, 30000);
check("Solo el cliente elige la propina: el conductor recibe 403", (await setTip(coCash, 1000, DRIVER.token)).status === 403);
check("Un tercero no elige la propina: 403", (await setTip(coCash, 1000, STRANGER.token)).status === 403);
const chosen = await setTip(coCash, 3000);
check("El cliente elige 3.000 de propina", chosen.status === 200 && chosen.data?.tip === 3000 && chosen.data.total === 33000, JSON.stringify(chosen.data));
check("Cambiar de opinión: 0 la quita", (await setTip(coCash, 0)).data?.total === 30000);
await setTip(coCash, 3000);
const cashPaid = await cash(coCash);
check("El conductor confirma el efectivo con la propina elegida", cashPaid.status === 200 && cashPaid.data?.tip === 3000, JSON.stringify(cashPaid.data));
const cashReceipt = await receipt(coCash);
check("Comprobante en efectivo: 33.000 en total", cashReceipt.data?.total === 33000 && line(cashReceipt, "TIP")?.amount === 3000 && cashReceipt.data.payment_method === "CASH");

// 5. Lo fijado al pagar no cambia: si el flete tiene guardado otro impuesto, el comprobante lo respeta
dbHelper("set-tax", String(co), "0.5", "1500");
const frozen = await receipt(co);
check("El comprobante usa el impuesto guardado al pagar, no la tasa actual del país", line(frozen, "TAX")?.rate === 0.5 && line(frozen, "TAX")?.amount === 1500, JSON.stringify(line(frozen, "TAX")));

// 6. Estados Unidos (dólares con centavos, propina sugerida 15/18/20 %): comisión 3,00, impuesto 8,875 % = 0,27
const us = await deliveredTrip(NUEVA_YORK, 30);
const usStatus = (await payment(us)).data;
check("Nueva York: modo SUGGESTED con 15, 18 y 20 %",
    usStatus?.currency === "USD" && usStatus.tip_mode === "SUGGESTED" && JSON.stringify(usStatus.tip_suggestions) === "[15,18,20]", JSON.stringify(usStatus));
const eighteen = Math.round(30 * 18) / 100;
const usTip = await setTip(us, eighteen);
check("Propina del 18 % de 30 USD = 5,40; total 35,40", usTip.status === 200 && usTip.data?.tip === 5.4 && usTip.data.total === 35.4, JSON.stringify(usTip.data));
check("Propina de 5,456 se redondea a los centavos: 5,46", (await setTip(us, 5.456)).data?.tip === 5.46);
await setTip(us, eighteen);
check("El conductor confirma el efectivo", (await cash(us)).status === 200);
const usReceipt = await receipt(us);
check("Comprobante US: Receipt en USD, total 35,40",
    usReceipt.data?.receipt_type === "RECEIPT" && usReceipt.data.currency === "USD" && usReceipt.data.total === 35.4 && usReceipt.data.tax_id_label === "EIN", JSON.stringify(usReceipt.data));
check("Sales tax 8,875 % de 3,00 = 0,27 (redondeado a centavos)",
    line(usReceipt, "COMMISSION")?.amount === 3 && line(usReceipt, "TAX")?.amount === 0.27 && line(usReceipt, "TAX")?.rate === 0.08875 && line(usReceipt, "TAX")?.name === "Sales tax", JSON.stringify(line(usReceipt, "TAX")));

// 7. Francia (euros, propina prohibida): TVA 20 % de 3,00 = 0,60
const fr = await deliveredTrip(PARIS, 30);
const frStatus = (await payment(fr)).data;
check("París: modo NONE sin sugerencias", frStatus?.currency === "EUR" && frStatus.tip_mode === "NONE" && frStatus.tip_suggestions?.length === 0, JSON.stringify(frStatus));
const frTip = await setTip(fr, 2);
check("Propina en un país sin propina: 400 TIP_NOT_ALLOWED", frTip.status === 400 && frTip.data?.key === "TIP_NOT_ALLOWED", `${frTip.status} ${frTip.data?.key}`);
const frOnlineTip = await startOnline(fr, { tip: 2 });
check("Tampoco al abrir el pago por la app: 400", frOnlineTip.status === 400 && frOnlineTip.data?.key === "TIP_NOT_ALLOWED");
const frCashTip = await cash(fr, { tip: 1 });
check("Tampoco al confirmar el efectivo: 400", frCashTip.status === 400 && frCashTip.data?.key === "TIP_NOT_ALLOWED");
check("Propina 0 sí vale", (await setTip(fr, 0)).status === 200);
check("El conductor confirma el efectivo sin propina", (await cash(fr, { tip: 0 })).status === 200);
const frReceipt = await receipt(fr);
check("Comprobante FR: Facture en EUR, total 30,00", frReceipt.data?.receipt_type === "FACTURE" && frReceipt.data.currency === "EUR" && frReceipt.data.total === 30 && frReceipt.data.tax_id_label === "SIRET", JSON.stringify(frReceipt.data));
check("TVA 20 % de 3,00 = 0,60", line(frReceipt, "TAX")?.amount === 0.6 && line(frReceipt, "TAX")?.rate === 0.2 && line(frReceipt, "TAX")?.name === "TVA");

// 8. Alemania (euros, propina opcional): MwSt. 19 % de 3,00 = 0,57, con propina de 1,50
const de = await deliveredTrip(BERLIN, 30);
check("Berlín: propina opcional", (await payment(de)).data?.tip_mode === "OPTIONAL");
const deCash = await cash(de, { tip: 1.5 });
check("El conductor confirma el efectivo con una propina de 1,50", deCash.status === 200 && deCash.data?.tip === 1.5, JSON.stringify(deCash.data));
const deReceipt = await receipt(de);
check("Comprobante DE: Rechnung, total 31,50, MwSt. 0,57",
    deReceipt.data?.receipt_type === "RECHNUNG" && deReceipt.data.total === 31.5 && line(deReceipt, "TAX")?.amount === 0.57 && line(deReceipt, "TAX")?.name === "MwSt.", JSON.stringify(deReceipt.data?.lines));

// 9. Reembolso (B). Cobro doble: el cliente abre el checkout, cambia a efectivo, el conductor confirma y después llega
// aprobado el pago por la app. El efectivo se respeta y el pago por la app queda REFUNDED con su fecha
const double = await deliveredTrip(BOGOTA, 30000);
const doubleStart = await startOnline(double);
await fetch(doubleStart.data.checkout_url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ method: "CARD", card_number: "4242424242424242", expiry: "12/39", cvc: "123", holder: "Prueba Fase Once" }).toString(),
});
check("El cliente cambia a efectivo antes de que se apruebe la tarjeta", (await call("PUT", `/client-requests/${double}/payment/method`, CLIENT.token, { payment_method: "CASH" })).status === 200);
check("El conductor confirma el efectivo", (await cash(double)).status === 200);
await wait(3000);
const refundedStatus = await call("POST", `/client-requests/${double}/payment/online/verify`, CLIENT.token);
check("El pago por la app que llegó de más queda reembolsado, con fecha y monto", refundedStatus.data?.refund?.amount === 30000 && !!refundedStatus.data.refund.refunded_at, JSON.stringify(refundedStatus.data?.refund));
check("El pago en efectivo se respeta: el flete sigue pagado con su comisión", refundedStatus.data?.paid_at && refundedStatus.data.payment_method === "CASH" && refundedStatus.data.commission === 3000);
check("El comprobante del flete sigue disponible y sin cobro doble: 30.000", (await receipt(double)).data?.total === 30000);

// Cancelación con un pago por la app ya aprobado: queda REFUNDED, sin pagar y sin comisión; el cliente recibe el aviso
const paidTrip = (await call("POST", "/client-requests", CLIENT.token, { pickup_lat: BOGOTA[0], pickup_lng: BOGOTA[1], destination_lat: BOGOTA[2], destination_lng: BOGOTA[3], fare_offered: 30000,
    pickup_description: "Prueba Fase 11 origen", destination_description: "Prueba Fase 11 destino", cargo_description: "Prueba Fase 11", weight_kg: 30, length_cm: 60, width_cm: 40, height_cm: 40, no_prohibited_items: true })).data;
await call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: paidTrip, fare_offered: 30000, time: 5, distance: 1 });
await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: paidTrip, id_driver_assigned: DRIVER.id });
dbHelper("fake-online-paid", String(paidTrip));
const socket = await connectSocket(CLIENT.token);
const refundEvent = new Promise((resolve) => { socket.on(`payment_refunded/${paidTrip}`, resolve); setTimeout(() => resolve(null), 4000); });
const canceled = await call("PUT", `/client-requests/${paidTrip}/cancel`, CLIENT.token, { reason: "Prueba de reembolso" });
check("El cliente cancela un flete pagado por la app", canceled.status === 200, `${canceled.status}`);
const event = await refundEvent;
socket.close();
check("El cliente recibe el aviso del reembolso al instante", event?.amount === 30000 && event.currency === "COP", JSON.stringify(event));
const afterCancel = (await payment(paidTrip)).data;
check("El pago queda REFUNDED con fecha, y el flete sin pagar", afterCancel?.paid_at === null && afterCancel.last_payment?.status === "REFUNDED" && !!afterCancel.last_payment.refunded_at && afterCancel.refund?.amount === 30000, JSON.stringify(afterCancel));
check("La comisión no se cobra: queda en 0", afterCancel?.commission === 0);
check("Un flete reembolsado no tiene comprobante: 409", (await receipt(paidTrip)).status === 409);

// El panel de administración muestra el reembolso
const ADMIN_EMAIL = `admin-reembolso${stamp}@prueba.com`;
await call("POST", "/auth/register", null, { name: "Admin", lastname: "Reembolso", email: ADMIN_EMAIL, phone: "3001234567", password: "admin123" });
dbHelper("grant-admin", ADMIN_EMAIL);
const adminLogin = await fetch(`${API}/admin/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN_EMAIL, password: "admin123" }) });
const adminCookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0];
const adminGet = async (path) => (await fetch(`${API}/admin/api${path}`, { headers: { Cookie: adminCookie } })).json().catch(() => null);
const adminPayments = await adminGet("/payments");
const refundedRows = adminPayments?.items?.filter((item) => item.status === "REFUNDED" && [paidTrip, double].includes(item.id_client_request)) ?? [];
check("El panel lista los dos pagos REFUNDED con su fecha", refundedRows.length === 2 && refundedRows.every((row) => row.refunded_at), JSON.stringify(refundedRows.map((r) => [r.id_client_request, r.refunded_at])));
const adminTrip = await adminGet(`/trips/${paidTrip}`);
check("El detalle del flete en el panel muestra el reembolso y la comisión en 0", !!adminTrip?.refunded_at && adminTrip.commission === 0 && adminTrip.payments?.some((p) => p.status === "REFUNDED" && p.refunded_at), JSON.stringify({ r: adminTrip?.refunded_at, c: adminTrip?.commission }));
const adminCash = await adminGet(`/trips/${co}`);
check("El detalle de un flete pagado muestra el impuesto fijado (IVA)", adminCash?.tax_name === "IVA" && adminCash.tax_amount === 1500, JSON.stringify({ n: adminCash?.tax_name, a: adminCash?.tax_amount }));

dbHelper("delete", STRANGER_EMAIL, ADMIN_EMAIL);
finish();
