// Comisión, precio por vehículo y pago al terminar el viaje (efectivo y por la app). Uso: npm test
// El pago por la app se prueba con el simulador: necesita PAYMENTS_SIMULATOR=true y sin llaves de Wompi en el .env
import { API, call, createReport, dbHelper, testClient, testDriver, uploadPhoto, wait } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();

const stamp = Date.now();
const STRANGER_EMAIL = `ajeno${stamp}@prueba.com`;
const stranger = await call("POST", "/auth/register", null, { name: "Usuario", lastname: "Ajeno", email: STRANGER_EMAIL, phone: "3009998877", password: "123456" });
const STRANGER = { token: stranger.data?.token };

const base = { pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 25000,
    pickup_description: "Prueba Fase 7 origen", destination_description: "Prueba Fase 7 destino", cargo_description: "Prueba Fase 7",
    weight_kg: 50, length_cm: 80, width_cm: 50, height_cm: 50, no_prohibited_items: true };
const status = (id, s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id, status: s });
const photo = (id, kind) => uploadPhoto(`/client-requests/${id}/photos`, DRIVER.token, { kind });

// Lleva un viaje nuevo hasta entregado con una oferta de $30.000
const deliveredTrip = async (extra) => {
    const id = (await call("POST", "/client-requests", CLIENT.token, { ...base, ...extra })).data;
    await call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: 30000, time: 5, distance: 1 });
    await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id, id_driver_assigned: DRIVER.id });
    await status(id, "ON_THE_WAY");
    await status(id, "ARRIVED");
    await photo(id, "PICKUP");
    await status(id, "TRAVELING");
    await photo(id, "DELIVERY");
    const { delivery_code } = (await call("GET", `/client-requests/${id}`, CLIENT.token)).data;
    return { id, delivery_code };
};
const deliver = (trip) => call("POST", `/client-requests/${trip.id}/deliver`, DRIVER.token, { code: trip.delivery_code });
const payment = (id, token = CLIENT.token) => call("GET", `/client-requests/${id}/payment`, token);
const startOnline = (id, token = CLIENT.token) => call("POST", `/client-requests/${id}/payment/online`, token);
const verify = (id, token = CLIENT.token) => call("POST", `/client-requests/${id}/payment/online/verify`, token);
const cash = (id, token = DRIVER.token) => call("POST", `/client-requests/${id}/payment/cash`, token);
// Lo que haría el cliente en la pasarela de prueba: llena el formulario del medio elegido y lo envía
const simulate = (url, fields) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
});
const payCard = (url, number) => simulate(url, { method: "CARD", card_number: number, expiry: "12/39", cvc: "123", holder: "Prueba Fase Siete" });
const payNequi = (url, phone) => simulate(url, { method: "NEQUI", phone });
// La pasarela deja el pago "procesando" un par de segundos antes de aprobarlo o rechazarlo
const waitProcessing = () => wait(3000);

// 1. Precio sugerido por vehículo: un camión cotiza más que un carry
const route = "/client-requests/4.61/-74.19/4.62/-74.14?weight=50&size=0.2";
const carry = (await call("GET", `${route}&vehicle=CARRY`, CLIENT.token)).data;
const truck = (await call("GET", `${route}&vehicle=CAMION`, CLIENT.token)).data;
check("El camión cotiza más que el carry", truck?.recommended_value > carry?.recommended_value, `${carry?.recommended_value} / ${truck?.recommended_value}`);
check("La cotización trae la comisión vigente", carry?.commission_rate === 0.1, String(carry?.commission_rate));
check("Vehículo inventado: 400", (await call("GET", `${route}&vehicle=MOTO`, CLIENT.token)).status === 400);

// 2. Pago por la app: método y valor declarado al publicar, comisión al asignar
const online = await deliveredTrip({ payment_method: "WOMPI", declared_value: 1500000 });
const detail = (await call("GET", `/client-requests/${online.id}`, CLIENT.token)).data;
check("El viaje guarda el método y el valor declarado", detail.payment_method === "WOMPI" && detail.declared_value === 1500000);
check("La comisión se fija al asignar: 10 % de $30.000", detail.commission === 3000 && detail.commission_rate === 0.1, `${detail.commission}`);
check("Antes de entregar no se paga: 409", (await startOnline(online.id)).status === 409);
check("Ajeno no ve el pago: 403", (await payment(online.id, STRANGER.token)).status === 403);

check("Entrega con código", (await deliver(online)).status === 200);
check("El conductor no abre el pago del cliente: 403", (await startOnline(online.id, DRIVER.token)).status === 403);
const first = await startOnline(online.id);
check("El cliente abre el checkout por $30.000", first.status === 201 && first.data?.amount === 30000 && first.data?.checkout_url?.includes("/payments/simulator/"), JSON.stringify(first.data));
check("Sin pagar todavía, verificar no lo marca pagado", (await verify(online.id)).data?.paid_at === null);
check("El conductor no confirma efectivo en un pago por la app: 409", (await cash(online.id)).status === 409);

const checkoutPage = await fetch(first.data.checkout_url);
const checkoutHtml = await checkoutPage.text();
check("La pasarela pide tarjeta, Nequi o PSE", checkoutPage.status === 200 && ["card_number", "name=\"phone\"", "name=\"bank\""].every((field) => checkoutHtml.includes(field)));
check("Tarjeta con número inválido: 400", (await payCard(first.data.checkout_url, "4242424242424241")).status === 400);
const realCard = await payCard(first.data.checkout_url, "4012888888881881");
check("Una tarjeta que no es de prueba no se acepta: 400", realCard.status === 400 && (await realCard.text()).includes("tarjetas de prueba"));
check("Tarjeta vencida: 400", (await simulate(first.data.checkout_url, { method: "CARD", card_number: "4242424242424242", expiry: "01/20", cvc: "123", holder: "Prueba" })).status === 400);
check("Nequi que no es de prueba: 400", (await payNequi(first.data.checkout_url, "3001234567")).status === 400);

const declinedPost = await payCard(first.data.checkout_url, "4111111111111111");
check("Tarjeta de prueba rechazada: muestra \"procesando\"", declinedPost.status === 200 && (await declinedPost.text()).includes("Procesando el pago"));
check("Mientras procesa, sigue pendiente", (await verify(online.id)).data?.last_payment?.status === "PENDING");
await waitProcessing();
const declined = await verify(online.id);
check("Pago rechazado: sigue sin pagar", declined.data?.paid_at === null && declined.data?.last_payment?.status === "DECLINED", JSON.stringify(declined.data?.last_payment));
check("El comprobante dice rechazado", (await (await fetch(first.data.checkout_url)).text()).includes("Pago rechazado"));
check("El mismo intento no se procesa dos veces: 409", (await payCard(first.data.checkout_url, "4242424242424242")).status === 409);

const second = await startOnline(online.id);
check("Cada intento tiene su propia referencia", second.data?.reference && second.data.reference !== first.data.reference);
await payNequi(second.data.checkout_url, "3991111111");
await waitProcessing();
const approved = await verify(online.id, DRIVER.token);
check("Pago aprobado con Nequi: el viaje queda pagado", approved.data?.paid_at && approved.data?.last_payment?.status === "APPROVED" && approved.data?.last_payment?.wompi_method === "NEQUI", JSON.stringify(approved.data));
const receipt = await (await fetch(second.data.checkout_url)).text();
check("El comprobante muestra solo los últimos 4 dígitos", receipt.includes("Pago aprobado") && receipt.includes("•••• 1111") && !receipt.includes("3991111111"));
check("Pagado no se vuelve a cobrar: 409", (await startOnline(online.id)).status === 409);
check("Pagado no se cambia el método: 409", (await call("PUT", `/client-requests/${online.id}/payment/method`, CLIENT.token, { payment_method: "CASH" })).status === 409);

// 3. Efectivo: lo confirma solo el conductor asignado, una vez
const cashTrip = await deliveredTrip({});
check("Por defecto el método es efectivo", (await payment(cashTrip.id)).data?.payment_method === "CASH");
await deliver(cashTrip);
check("El cliente no confirma el efectivo: 403", (await cash(cashTrip.id, CLIENT.token)).status === 403);
const paidCash = await cash(cashTrip.id);
check("El conductor confirma el efectivo", paidCash.status === 200 && paidCash.data?.paid_at && paidCash.data?.payment_method === "CASH", JSON.stringify(paidCash.data));
check("Confirmar dos veces: 409", (await cash(cashTrip.id)).status === 409);
const history = (await call("GET", `/client-requests/driver/assigned/${DRIVER.id}`, DRIVER.token)).data;
const row = history.find((t) => t.id === cashTrip.id);
check("El historial del conductor trae la comisión y el pago", row?.commission === 3000 && row?.paid_at && row?.payment_method === "CASH", JSON.stringify(row && { commission: row.commission, paid_at: row.paid_at }));

// 4. Cambiar de método antes de pagar
const switchTrip = await deliveredTrip({ payment_method: "WOMPI" });
await deliver(switchTrip);
const switched = await call("PUT", `/client-requests/${switchTrip.id}/payment/method`, CLIENT.token, { payment_method: "CASH" });
check("El cliente pasa de la app a efectivo", switched.status === 200 && switched.data?.payment_method === "CASH");
check("Método inventado: 400", (await call("PUT", `/client-requests/${switchTrip.id}/payment/method`, CLIENT.token, { payment_method: "BITCOIN" })).status === 400);
check("Y el conductor ya puede confirmar el efectivo", (await cash(switchTrip.id)).status === 200);

dbHelper("delete", STRANGER_EMAIL);
finish(`API: ${API}`);
