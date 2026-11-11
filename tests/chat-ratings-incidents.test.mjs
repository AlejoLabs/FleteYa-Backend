// Chat del viaje, calificaciones reales y reportes de incidentes. Uso: npm test
// Crea una cuenta @prueba.com para el "usuario ajeno" y la borra al final
import { API, call, connectSocket, createReport, dbHelper, testClient, testDriver, TINY_JPEG, uploadPhoto, wait, payDeliveredInCash } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const DRIVER_POS = "4.6105/-74.1895";

const stamp = Date.now();
const STRANGER_EMAIL = `ajeno${stamp}@prueba.com`;
const stranger = await call("POST", "/auth/register", null, { name: "Usuario", lastname: "Ajeno", email: STRANGER_EMAIL, phone: "3009998877", password: "123456" });
const STRANGER = { token: stranger.data?.token };

const base = { pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 25000,
    pickup_description: "Prueba Fase 5B origen", destination_description: "Prueba Fase 5B destino", cargo_description: "Prueba Fase 5B",
    weight_kg: 50, length_cm: 80, width_cm: 50, height_cm: 50, no_prohibited_items: true };
const created = [];
const createTrip = async () => { const id = (await call("POST", "/client-requests", CLIENT.token, base)).data; created.push(id); return id; };
const status = (id, s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id, status: s });
const offer = (id) => call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: 30000, time: 5, distance: 1 });
const assign = (id) => call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id, id_driver_assigned: DRIVER.id });
const send = (id, token, text) => call("POST", `/client-requests/${id}/messages`, token, { text });
const finishTrip = async (id) => {
    await status(id, "ARRIVED");
    await uploadPhoto(`/client-requests/${id}/photos`, DRIVER.token, { kind: "PICKUP" });
    await status(id, "TRAVELING");
    await uploadPhoto(`/client-requests/${id}/photos`, DRIVER.token, { kind: "DELIVERY" });
    const { delivery_code } = (await call("GET", `/client-requests/${id}`, CLIENT.token)).data;
    return call("POST", `/client-requests/${id}/deliver`, DRIVER.token, { code: delivery_code });
};
const isRating = (r) => r && typeof r.count === "number" && (r.average === null || (r.average >= 1 && r.average <= 5));

// Formulario como el de la app: kind y description de texto, y las fotos en "photos"
const report = async (id, token, fields, photos = []) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const bytes of photos) form.append("photos", new Blob([bytes], { type: "image/jpeg" }), "foto.jpg");
    const res = await fetch(`${API}/client-requests/${id}/incidents`, { method: "POST", headers: token ? { Authorization: token } : {}, body: form });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
};

// 1. Calificación real en la oferta y en la lista del conductor; sin celulares
const trip = await createTrip();
const nearby = (await call("GET", `/client-requests/${DRIVER_POS}`, DRIVER.token)).data.find((r) => r.id === trip);
check("La lista del conductor trae la calificación del cliente", isRating(nearby?.client?.rating), JSON.stringify(nearby?.client?.rating));
await offer(trip);
const offers = (await call("GET", `/driver-trip-offers/findByClientRequest/${trip}`, CLIENT.token)).data;
const myOffer = Array.isArray(offers) ? offers.find((o) => o.id_driver === DRIVER.id) : null;
check("La oferta trae la calificación del conductor", isRating(myOffer?.driver?.rating), JSON.stringify(myOffer?.driver));
check("La oferta no trae el celular del conductor", myOffer && !("phone" in myOffer.driver));

// 2. Chat: solo con conductor asignado y viaje en curso
check("Sin conductor el chat está cerrado: 409", (await send(trip, CLIENT.token, "Hola")).status === 409);
await assign(trip);
const detail = (await call("GET", `/client-requests/${trip}`, CLIENT.token)).data;
check("El detalle del viaje no trae celulares", !("phone" in detail.client) && !("phone" in detail.driver), JSON.stringify({ c: detail.client, d: detail.driver }));
check("El detalle trae la calificación de los dos", isRating(detail.client.rating) && isRating(detail.driver.rating));

const driverSocket = await connectSocket(DRIVER.token);
const received = [];
driverSocket.on(`trip_message/${trip}`, (message) => received.push(message));
const hello = await send(trip, CLIENT.token, "  Hola, ¿a qué hora llegas?  ");
check("El cliente escribe al conductor", hello.status === 201 && hello.data?.text === "Hola, ¿a qué hora llegas?" && hello.data?.id_sender === CLIENT.id, JSON.stringify(hello.data));
await wait(400);
check("El conductor recibe el mensaje por socket", received.some((m) => m.id === hello.data?.id));
driverSocket.close();
check("El conductor responde", (await send(trip, DRIVER.token, "En 10 minutos")).status === 201);
check("Mensaje vacío: 400", (await send(trip, CLIENT.token, "   ")).status === 400);
check("Mensaje de más de 500 caracteres: 400", (await send(trip, CLIENT.token, "a".repeat(501))).status === 400);
check("Un usuario ajeno no escribe: 403", (await send(trip, STRANGER.token, "Hola")).status === 403);
check("Un usuario ajeno no lee el chat: 403", (await call("GET", `/client-requests/${trip}/messages`, STRANGER.token)).status === 403);
check("Sin sesión no se lee el chat: 401", (await call("GET", `/client-requests/${trip}/messages`, null)).status === 401);

const history = (await call("GET", `/client-requests/${trip}/messages`, DRIVER.token)).data;
check("Los dos mensajes en orden", Array.isArray(history) && history.length === 2 && history[0].id === hello.data.id, JSON.stringify(history));
const read = await call("PUT", `/client-requests/${trip}/messages/read`, DRIVER.token);
check("El conductor marca como leído solo lo que le llegó", read.data?.updated === 1, JSON.stringify(read.data));
const afterRead = (await call("GET", `/client-requests/${trip}/messages`, CLIENT.token)).data;
check("El mensaje del cliente queda leído y el del conductor no", afterRead[0].read_at !== null && afterRead[1].read_at === null);

// Freno de ráfagas: 20 por minuto (ya mandó 1)
const burst = [];
for (let i = 0; i < 20; i++) burst.push((await send(trip, CLIENT.token, `Mensaje ${i}`)).status);
check("El mensaje 21 en un minuto: 429", burst.slice(0, 19).every((s) => s === 201) && burst[19] === 429, burst.join(","));

// 3. Incidente durante el viaje, con fotos
check("Sin sesión no se reporta: 401", (await report(trip, null, { kind: "DAMAGE", description: "Se rompió una caja" })).status === 401);
check("Un usuario ajeno no reporta: 403", (await report(trip, STRANGER.token, { kind: "DAMAGE", description: "Se rompió una caja" })).status === 403);
check("Tipo inventado: 400", (await report(trip, CLIENT.token, { kind: "ROBO", description: "Se rompió una caja" })).status === 400);
check("Descripción muy corta: 400", (await report(trip, CLIENT.token, { kind: "DAMAGE", description: "roto" })).status === 400);
check("Cinco fotos: 400", (await report(trip, CLIENT.token, { kind: "DAMAGE", description: "Se rompió una caja" }, Array(5).fill(TINY_JPEG))).status === 400);
check("Una foto falsa: 400", (await report(trip, CLIENT.token, { kind: "DAMAGE", description: "Se rompió una caja" }, [TINY_JPEG, Buffer.from("no soy foto")])).status === 400);
check("Las fotos rechazadas no dejan reporte", (await call("GET", `/client-requests/${trip}/incidents`, CLIENT.token)).data?.length === 0);

const damage = await report(trip, CLIENT.token, { kind: "DAMAGE", description: "Se rompió la pata de la mesa al cargarla" }, [TINY_JPEG, TINY_JPEG]);
check("El cliente reporta un daño con 2 fotos", damage.status === 201 && damage.data?.status === "OPEN" && damage.data?.photos?.length === 2, JSON.stringify(damage.data));
const photoUrl = damage.data?.photos?.[0]?.url;
const own = await fetch(API + photoUrl, { headers: { Authorization: CLIENT.token } });
check("Quien reporta ve la foto", own.status === 200 && own.headers.get("content-type")?.startsWith("image/jpeg"));
check("El conductor no ve el reporte del cliente", (await call("GET", `/client-requests/${trip}/incidents`, DRIVER.token)).data?.length === 0);
check("El conductor no descarga la foto del reporte: 403", (await fetch(API + photoUrl, { headers: { Authorization: DRIVER.token } })).status === 403);
check("El conductor reporta sin fotos", (await report(trip, DRIVER.token, { kind: "DELAY", description: "Nadie recibía en el destino" })).status === 201);
await report(trip, CLIENT.token, { kind: "OTHER", description: "Segundo reporte de prueba" });
await report(trip, CLIENT.token, { kind: "OTHER", description: "Tercer reporte de prueba" });
check("El cuarto reporte del mismo viaje: 409", (await report(trip, CLIENT.token, { kind: "OTHER", description: "Cuarto reporte de prueba" })).status === 409);

// 4. Calificar: una sola vez, y el promedio cuenta el voto nuevo
const before = (await call("GET", `/client-requests/${trip}`, CLIENT.token)).data.driver.rating;
check("No se califica antes de terminar: 409", (await call("PUT", "/client-requests/update_driver_rating", CLIENT.token, { id: trip, driver_rating: 5 })).status === 409);
check("El viaje termina", (await finishTrip(trip)).data?.status === "FINISHED");
check("Terminado, el chat ya no recibe mensajes: 409", (await send(trip, CLIENT.token, "Gracias")).status === 409);
check("Terminado, el historial se sigue viendo", (await call("GET", `/client-requests/${trip}/messages`, CLIENT.token)).data?.length === 21);
check("El cliente califica al conductor", (await call("PUT", "/client-requests/update_driver_rating", CLIENT.token, { id: trip, driver_rating: 4 })).status === 200);
check("Calificar dos veces: 409", (await call("PUT", "/client-requests/update_driver_rating", CLIENT.token, { id: trip, driver_rating: 1 })).status === 409);
check("El conductor califica al cliente", (await call("PUT", "/client-requests/update_client_rating", DRIVER.token, { id: trip, client_rating: 5 })).status === 200);
const after = (await call("GET", `/client-requests/${trip}`, CLIENT.token)).data.driver.rating;
check("El conductor tiene un voto más", after.count === before.count + 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

// 5. Una semana después del viaje ya no se reporta desde la app
const late = await createTrip();
await offer(late);
await assign(late);
await finishTrip(late);
check("Recién terminado sí se reporta", (await report(late, DRIVER.token, { kind: "BEHAVIOR", description: "Reporte de prueba a tiempo" })).status === 201);
dbHelper("age", late, 8);
check("Ocho días después: 409", (await report(late, CLIENT.token, { kind: "DAMAGE", description: "Reporte de prueba tardío" })).status === 409);

dbHelper("delete", STRANGER_EMAIL);
await payDeliveredInCash(created, DRIVER.token);
finish(`Fletes de prueba: ${created.join(", ")}`);
