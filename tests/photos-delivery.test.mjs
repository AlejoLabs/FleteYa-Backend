// Fotos del flete y del vehículo, prueba de entrega con código, documentos y token de notificaciones. Uso: npm test
// Crea una cuenta @prueba.com para el "usuario ajeno" y la borra al final
import { API, call, createReport, dbHelper, testClient, testDriver, uploadPhoto } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const DRIVER_POS = "4.6105/-74.1895";

const stamp = Date.now();
const STRANGER_EMAIL = `ajeno${stamp}@prueba.com`;
const stranger = await call("POST", "/auth/register", null, { name: "Usuario", lastname: "Ajeno", email: STRANGER_EMAIL, phone: "3009998877", password: "123456" });
const STRANGER = { token: stranger.data?.token };

const base = { pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 25000,
    pickup_description: "Prueba Fase 5 origen", destination_description: "Prueba Fase 5 destino", cargo_description: "Prueba Fase 5",
    weight_kg: 50, length_cm: 80, width_cm: 50, height_cm: 50, no_prohibited_items: true };
const created = [];
const createTrip = async () => { const id = (await call("POST", "/client-requests", CLIENT.token, base)).data; created.push(id); return id; };
const photo = (id, token, kind, bytes) => uploadPhoto(`/client-requests/${id}/photos`, token, { kind }, bytes);
const status = (id, s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id, status: s });
const assign = async (id) => {
    await call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: 30000, time: 5, distance: 1 });
    return call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id, id_driver_assigned: DRIVER.id });
};
const fetchFile = (url, token) => fetch(API + url, { headers: token ? { Authorization: token } : {} });

// 1. Fotos de la carga: solo el cliente, solo imágenes de verdad y máximo 4
const trip = await createTrip();
check("Sin sesión no se sube nada: 401", (await photo(trip, null, "CARGO")).status === 401);
const first = await photo(trip, CLIENT.token, "CARGO");
check("Cliente sube una foto de la carga", first.status === 201 && first.data?.kind === "CARGO" && first.data?.url?.includes(`/client-requests/${trip}/photos/`), JSON.stringify(first.data));
check("Un texto disfrazado de JPG: 400", (await photo(trip, CLIENT.token, "CARGO", Buffer.from("no soy una foto"))).status === 400);
check("Tipo de foto inventado: 400", (await photo(trip, CLIENT.token, "SELFIE")).status === 400);
check("El conductor no sube fotos de la carga: 403", (await photo(trip, DRIVER.token, "CARGO")).status === 403);
check("Foto al cargar antes de tener conductor: 403", (await photo(trip, DRIVER.token, "PICKUP")).status === 403);
for (let i = 0; i < 3; i++) await photo(trip, CLIENT.token, "CARGO");
check("La quinta foto de la carga: 409", (await photo(trip, CLIENT.token, "CARGO")).status === 409);

// 2. Mientras busca conductor, los conductores ven las fotos de la carga; un cliente ajeno no
const driverList = await call("GET", `/client-requests/${trip}/photos`, DRIVER.token);
check("El conductor ve las 4 fotos de la carga", driverList.status === 200 && driverList.data.length === 4);
check("La lista del conductor dice cuántas fotos hay", (await call("GET", `/client-requests/${DRIVER_POS}`, DRIVER.token)).data.find((r) => r.id === trip)?.cargo_photos === 4);
const file = await fetchFile(first.data.url, DRIVER.token);
check("El conductor descarga la foto", file.status === 200 && file.headers.get("content-type")?.startsWith("image/jpeg"), `${file.status} ${file.headers.get("content-type")}`);
check("Un cliente ajeno no ve las fotos: 403", (await call("GET", `/client-requests/${trip}/photos`, STRANGER.token)).status === 403);
check("Sin sesión no se descarga: 401", (await fetchFile(first.data.url, null)).status === 401);
check("El cliente borra una foto de la carga", (await call("DELETE", first.data.url, CLIENT.token)).status === 200);
check("El conductor no borra fotos ajenas: 403", (await call("DELETE", driverList.data[1].url, DRIVER.token)).status === 403);

// 3. Asignado: el código de entrega solo lo ve el cliente
check("Cliente asigna al conductor", (await assign(trip)).status === 200);
const clientView = (await call("GET", `/client-requests/${trip}`, CLIENT.token)).data;
const driverView = (await call("GET", `/client-requests/${trip}`, DRIVER.token)).data;
check("El cliente ve un código de 4 dígitos", /^\d{4}$/.test(clientView.delivery_code ?? ""), clientView.delivery_code);
check("El conductor no ve el código", driverView.delivery_code === undefined);
check("Asignado el viaje, otros conductores ya no ven las fotos", (await call("GET", `/client-requests/${trip}/photos`, STRANGER.token)).status === 403);

// 4. Foto al cargar: obligatoria para pasar a "Carga recogida"
await status(trip, "ON_THE_WAY");
await status(trip, "ARRIVED");
check("Sin foto al cargar no pasa a TRAVELING: 409", (await status(trip, "TRAVELING")).status === 409);
check("Foto de entrega antes de recoger: 409", (await photo(trip, DRIVER.token, "DELIVERY")).status === 409);
check("El conductor toma la foto al cargar", (await photo(trip, DRIVER.token, "PICKUP")).status === 201);
check("Con la foto pasa a TRAVELING", (await status(trip, "TRAVELING")).status === 200);

// 5. Entregar con código
check("Ya no se termina cambiando el estado: 409", (await status(trip, "FINISHED")).status === 409);
const deliver = (id, code, token = DRIVER.token) => call("POST", `/client-requests/${id}/deliver`, token, { code });
check("Sin foto de entrega no se cierra: 409", (await deliver(trip, clientView.delivery_code)).status === 409);
check("El conductor toma la foto de entrega", (await photo(trip, DRIVER.token, "DELIVERY")).status === 201);
const wrongCode = clientView.delivery_code === "0000" ? "1111" : "0000";
const wrong = await deliver(trip, wrongCode);
check("Código equivocado: 400 con intentos restantes", wrong.status === 400 && /quedan 4/.test(wrong.data?.message), wrong.data?.message);
check("Código de 3 dígitos: 400", (await deliver(trip, "123")).status === 400);
check("El cliente no usa el endpoint del conductor: 403", (await deliver(trip, clientView.delivery_code, CLIENT.token)).status === 403);
const ok = await deliver(trip, clientView.delivery_code);
check("Código correcto cierra el viaje", ok.status === 200 && ok.data?.status === "FINISHED", JSON.stringify(ok.data));
const allPhotos = (await call("GET", `/client-requests/${trip}/photos`, CLIENT.token)).data;
check("El cliente ve las fotos de carga y de entrega", ["CARGO", "PICKUP", "DELIVERY"].every((k) => allPhotos.some((p) => p.kind === k)));

// 6. Intentos agotados: el cliente confirma la entrega desde su app
const trip2 = await createTrip();
await assign(trip2);
await status(trip2, "ARRIVED");
await photo(trip2, DRIVER.token, "PICKUP");
await status(trip2, "TRAVELING");
await photo(trip2, DRIVER.token, "DELIVERY");
const code2 = (await call("GET", `/client-requests/${trip2}`, CLIENT.token)).data.delivery_code;
const bad2 = code2 === "0000" ? "1111" : "0000";
for (let i = 0; i < 5; i++) await deliver(trip2, bad2);
check("Tras 5 intentos ni el código correcto sirve: 429", (await deliver(trip2, code2)).status === 429);
check("El conductor no confirma por el cliente: 403", (await call("PUT", `/client-requests/${trip2}/confirm-delivery`, DRIVER.token)).status === 403);
check("El cliente confirma la entrega", (await call("PUT", `/client-requests/${trip2}/confirm-delivery`, CLIENT.token)).data?.status === "FINISHED");

// 7. Fotos del vehículo
const carPhoto = await uploadPhoto("/driver-car-info/me/photos", DRIVER.token);
check("El conductor sube una foto de su vehículo", carPhoto.status === 201, JSON.stringify(carPhoto.data));
check("Un cliente no sube fotos de vehículo: 403", (await uploadPhoto("/driver-car-info/me/photos", CLIENT.token)).status === 403);
const carPhotos = await call("GET", `/driver-car-info/${DRIVER.id}/photos`, CLIENT.token);
check("El cliente ve las fotos del vehículo", carPhotos.status === 200 && carPhotos.data.some((p) => p.id === carPhoto.data?.id));
check("El cliente descarga la foto del vehículo", (await fetchFile(carPhoto.data.url, CLIENT.token)).status === 200);
check("El conductor borra su foto", (await call("DELETE", `/driver-car-info/me/photos/${carPhoto.data.id}`, DRIVER.token)).status === 200);

// 8. Datos del vehículo: el cliente no ve números de licencia ni de tarjeta de propiedad
const carForClient = (await call("GET", `/driver-car-info/${DRIVER.id}`, CLIENT.token)).data;
check("El cliente ve placa y tipo, no la licencia", carForClient.plate && carForClient.vehicle_type && !("license_number" in carForClient) && !("property_card_number" in carForClient), Object.keys(carForClient).join(","));
check("El conductor ve sus propios datos completos", "license_number" in (await call("GET", `/driver-car-info/${DRIVER.id}`, DRIVER.token)).data);

// 9. Documentos y token de notificaciones
const docs = await call("GET", "/driver-car-info/me/documents", DRIVER.token);
check("El conductor consulta sus documentos", docs.status === 200 && Array.isArray(docs.data) && docs.data.every((d) => ["OK", "EXPIRING", "EXPIRED"].includes(d.status)), JSON.stringify(docs.data));
check("Un cliente no tiene documentos de conductor: 403", (await call("GET", "/driver-car-info/me/documents", CLIENT.token)).status === 403);
check("Token de notificaciones muy corto: 400", (await call("PUT", "/users/me/notification-token", STRANGER.token, { token: "abc" })).status === 400);
check("Guarda el token de notificaciones", (await call("PUT", "/users/me/notification-token", STRANGER.token, { token: `prueba-token-${stamp}-xxxxxxxxxxxxxxxx` })).data?.saved === true);
check("Al cerrar sesión se borra el token", (await call("PUT", "/users/me/notification-token", STRANGER.token, { token: null })).data?.saved === false);

// Limpieza: los viajes de prueba quedaron terminados; se borra la cuenta ajena
dbHelper("delete", STRANGER_EMAIL);
finish(`Fletes de prueba: ${created.join(", ")}`);
