// Autorización: cada usuario solo ve y toca lo suyo, en la API y en los sockets. Uso: npm test
import { io } from "socket.io-client";
import { API, call, createReport, testClient, testDriver, TEST_PASSWORD } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const CLIENT_EMAIL = process.env.TEST_CLIENT_EMAIL;

// 1. Login: mismo mensaje con correo inexistente o contraseña mala
// Correo distinto en cada corrida: los fallos cuentan para el bloqueo por intentos
const missingEmail = `noexiste-${Date.now()}@x.com`;
const badEmail = await call("POST", "/auth/login", null, { email: missingEmail, password: TEST_PASSWORD });
const badPass = await call("POST", "/auth/login", null, { email: CLIENT_EMAIL, password: "malaaa" });
check("Login no revela si el correo existe", badEmail.status === 401 && badPass.status === 401 && badEmail.data.message === badPass.data.message, `${badEmail.status}/${badPass.status} "${badEmail.data.message}"`);
for (let i = 0; i < 4; i++) await call("POST", "/auth/login", null, { email: missingEmail, password: TEST_PASSWORD });
const locked = await call("POST", "/auth/login", null, { email: missingEmail, password: TEST_PASSWORD });
check("Tras 5 fallos con el mismo correo: 429", locked.status === 429, `${locked.status}`);

// 2. Sin token
check("Sin token: 401", (await call("GET", "/client-requests/1")).status === 401);
// La app reconoce este código para cerrar la sesión y volver al inicio (otros 401, como una contraseña mala, no)
const expired = await call("GET", "/client-requests/1", "Bearer token.vencido.x");
check("Token inválido: 401 con código SESSION_EXPIRED", expired.status === 401 && expired.data.code === "SESSION_EXPIRED", `${expired.status} ${expired.data.code}`);

// 3. Cliente crea un flete; manda id_client de otro usuario y el backend lo ignora
const tripBody = { id_client: DRIVER.id, pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14,
  fare_offered: 25000, pickup_description: "Prueba seguridad origen", destination_description: "Prueba seguridad destino",
  cargo_description: "Prueba Fase 2", no_prohibited_items: true, weight_kg: 10, length_cm: 50, width_cm: 50, height_cm: 50 };
const created = await call("POST", "/client-requests", CLIENT.token, tripBody);
const tripId = created.data;
check("Cliente crea flete", created.status === 201 && Number.isInteger(tripId), `id=${tripId}`);

// 4. Precio mínimo al crear
const cheap = await call("POST", "/client-requests", CLIENT.token, { ...tripBody, fare_offered: 12 });
check("Flete de $12 rechazado", cheap.status === 400, `${cheap.status} ${JSON.stringify(cheap.data?.message)}`);

// 5. Otro usuario no puede ver el flete ni sus ofertas
check("Conductor no participante no ve el flete", (await call("GET", `/client-requests/${tripId}`, DRIVER.token)).status === 403);
check("Otro usuario no ve las ofertas", (await call("GET", `/driver-trip-offers/findByClientRequest/${tripId}`, DRIVER.token)).status === 403);
check("Dueño sí ve las ofertas", (await call("GET", `/driver-trip-offers/findByClientRequest/${tripId}`, CLIENT.token)).status === 200);

// 6. Ofertas: solo conductores, con precio válido, y el id_driver sale del token
check("Cliente sin rol conductor no puede ofertar", (await call("POST", "/driver-trip-offers", CLIENT.token, { id_driver: DRIVER.id, id_client_request: tripId, fare_offered: 30000, time: 5, distance: 1 })).status === 403);
const lowOffer = await call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: tripId, fare_offered: 12, time: 5, distance: 1 });
check("Oferta de $12 rechazada", lowOffer.status === 400, `${lowOffer.status}`);
const offer = await call("POST", "/driver-trip-offers", DRIVER.token, { id_driver: 999, id_client_request: tripId, fare_offered: 30000, time: 5, distance: 1 });
check("Oferta válida usa el conductor del token", offer.status === 201 && offer.data.id_driver === DRIVER.id, `${offer.status} id_driver=${offer.data?.id_driver}`);

// 7. Sockets: sin token se rechaza; con token, la oferta llega solo al dueño
const connect = (token) => new Promise((resolve) => {
  const s = io(API, { transports: ["websocket"], reconnection: false, auth: { token } });
  s.on("connect", () => resolve({ s, ok: true }));
  s.on("connect_error", (e) => resolve({ s, ok: false, err: e.message }));
});
const anon = await connect("");
check("Socket sin token rechazado", anon.ok === false, anon.err);
anon.s.close();
const clientSock = (await connect(CLIENT.token)).s;
const driverSock = (await connect(DRIVER.token)).s;
const gotOffer = { client: false, driver: false };
clientSock.on(`created_driver_offer/${tripId}`, () => { gotOffer.client = true; });
driverSock.on(`created_driver_offer/${tripId}`, () => { gotOffer.driver = true; });
driverSock.emit("new_driver_offer", { id_client_request: tripId });
await new Promise((r) => setTimeout(r, 1200));
check("Aviso de oferta llega solo al cliente dueño", gotOffer.client && !gotOffer.driver, JSON.stringify(gotOffer));

// 8. Asignar: solo el dueño, y el precio sale de la oferta (se manda $1 y debe quedar $30.000)
check("Otro usuario no puede asignar", (await call("PUT", "/client-requests/updateDriverAssigned", DRIVER.token, { id: tripId, id_driver_assigned: DRIVER.id, fare_assigned: 1 })).status === 403);
const gotAssigned = { driver: false };
driverSock.on(`driver_assigned/${DRIVER.id}`, () => { gotAssigned.driver = true; });
const assigned = await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: tripId, id_driver_assigned: DRIVER.id, fare_assigned: 1 });
check("Precio asignado sale de la oferta", assigned.status === 200 && assigned.data.fare_assigned === 30000, `${assigned.status} fare_assigned=${assigned.data?.fare_assigned}`);
clientSock.emit("new_driver_assigned", { id_client_request: tripId, id_driver: 1 });
await new Promise((r) => setTimeout(r, 1200));
check("Aviso de asignación llega al conductor de la BD", gotAssigned.driver);
check("No se puede asignar dos veces", (await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: tripId, id_driver_assigned: DRIVER.id })).status === 409);

// 9. Estados: solo el conductor asignado y en orden
check("Cliente no puede cambiar el estado", (await call("PUT", "/client-requests/update_status", CLIENT.token, { id: tripId, status: "ARRIVED" })).status === 403);
check("No se salta de ACCEPTED a FINISHED", (await call("PUT", "/client-requests/update_status", DRIVER.token, { id: tripId, status: "FINISHED" })).status === 409);
check("Estado inventado rechazado", (await call("PUT", "/client-requests/update_status", DRIVER.token, { id: tripId, status: "PAGADO" })).status === 400);
check("Conductor pasa a ARRIVED", (await call("PUT", "/client-requests/update_status", DRIVER.token, { id: tripId, status: "ARRIVED" })).status === 200);

// 10. Calificar solo con el viaje terminado
check("No se califica un viaje sin terminar", (await call("PUT", "/client-requests/update_driver_rating", CLIENT.token, { id: tripId, driver_rating: 5 })).status === 409);

// 11. Historiales y perfil: solo los propios
check("Cliente no ve el historial de otro", (await call("GET", `/client-requests/client/assigned/${DRIVER.id}`, CLIENT.token)).status === 403);
check("Conductor no ve el historial de otro conductor", (await call("GET", `/client-requests/driver/assigned/${CLIENT.id}`, DRIVER.token)).status === 403);
check("No se edita el perfil de otro", (await call("PUT", `/users/upload/${CLIENT.id}`, DRIVER.token, { name: "Hack" })).status === 403);

// 12. Posición del conductor: longitud negativa válida y el id sale del token
const pos = await call("POST", "/drivers-position", DRIVER.token, { id_driver: CLIENT.id, lat: 4.61, lng: -74.189 });
check("Posición con longitud negativa aceptada y del conductor del token", pos.status === 201 && pos.data.id_driver === DRIVER.id, `${pos.status} id_driver=${pos.data?.id_driver}`);
check("Cliente sin rol conductor no publica posición", (await call("POST", "/drivers-position", CLIENT.token, { lat: 4.6, lng: -74.1 })).status === 403);

// Limpieza: el flete quedó en ARRIVED y se cancela para que no aparezca en "Próximos fletes"
await call("PUT", `/client-requests/${tripId}/cancel`, CLIENT.token, { reason: "Limpieza de pruebas" });
clientSock.close();
driverSock.close();

finish(`Flete de prueba: ${tripId}`);
