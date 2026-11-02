// Negociación del flete: ofertas, contraofertas, precio, "No me interesa", estados, cancelación y vencimiento. Uso: npm test
import { call, connectSocket, createReport, dbHelper, testClient, testDriver, uploadPhoto, wait } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const DRIVER_POS = "4.6105/-74.1895";

const clientSock = await connectSocket(CLIENT.token);
const driverSock = await connectSocket(DRIVER.token);
const events = [];
clientSock.onAny((name, payload) => events.push({ to: "client", name, payload }));
driverSock.onAny((name, payload) => events.push({ to: "driver", name, payload }));
const got = (to, name, idTrip) => events.some((e) => e.to === to && e.name === name && (idTrip === undefined || e.payload?.id_client_request === idTrip));

const base = { pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 25000,
  pickup_description: "Prueba Fase 3 origen", destination_description: "Prueba Fase 3 destino", cargo_description: "Prueba Fase 3",
  weight_kg: 100, length_cm: 100, width_cm: 60, height_cm: 50, no_prohibited_items: true };
const create = (extra = {}) => call("POST", "/client-requests", CLIENT.token, { ...base, ...extra });
const nearby = async () => (await call("GET", `/client-requests/${DRIVER_POS}`, DRIVER.token)).data;
const offer = (id, fare) => call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: fare, time: 5, distance: 1 });
const offersOf = async (id) => (await call("GET", `/driver-trip-offers/findByClientRequest/${id}`, CLIENT.token)).data;
const created = [];

// 1. Validaciones de la carga
check("Sin confirmar carga permitida: 400", (await create({ no_prohibited_items: false })).status === 400);
check("Carga de 20 toneladas: 400", (await create({ weight_kg: 20000 })).status === 400);
check("Quien recibe sin celular: 400", (await create({ receiver_name: "Ana" })).status === 400);
check("Celular inválido: 400", (await create({ receiver_name: "Ana", receiver_phone: "12345" })).status === 400);
check("Programado en 30 minutos: 400", (await create({ scheduled_at: new Date(Date.now() + 30 * 60000).toISOString() })).status === 400);

// 2. Vehículo: una carga de 3 toneladas pide furgón y el conductor (estacas) no la ve ni puede ofertar
const big = (await create({ weight_kg: 3000, cargo_category: "MATERIALES" })).data; created.push(big);
const small = (await create({ cargo_category: "MUDANZA", packages: 3, is_fragile: true, helpers: 2, pickup_floor: 3, pickup_has_elevator: false,
  receiver_name: "Ana Pérez", receiver_phone: "3001234567" })).data; created.push(small);
const list1 = await nearby();
const smallRow = list1.find((r) => r.id === small);
check("Carga de 3 t no le aparece al de estacas", !list1.some((r) => r.id === big) && !!smallRow, `ids=${list1.map((r) => r.id)}`);
check("Oferta en carga que no cabe: 409", (await offer(big, 40000)).status === 409);
check("Lista del conductor sin celular del cliente", smallRow && smallRow.client.phone === undefined);
check("Lista con datos de carga y cargue", smallRow?.cargo_category === "MUDANZA" && smallRow?.is_fragile === true && smallRow?.helpers === 2 && smallRow?.pickup_has_elevator === false && smallRow?.required_vehicle === "CARRY",
  JSON.stringify({ c: smallRow?.cargo_category, f: smallRow?.is_fragile, h: smallRow?.helpers, e: smallRow?.pickup_has_elevator, v: smallRow?.required_vehicle }));

// 3. Oferta, contraoferta y "Tu oferta"
await offer(small, 30000);
const second = await offer(small, 32000);
const offers1 = await offersOf(small);
check("Contraoferta reemplaza a la anterior", offers1.length === 1 && offers1[0].fare_offered === 32000, `n=${offers1.length} $${offers1[0]?.fare_offered}`);
check("La lista muestra mi oferta", (await nearby()).find((r) => r.id === small)?.my_offer === 32000);

// 4. Cliente rechaza: el conductor recibe el aviso y la oferta desaparece
check("Otro usuario no rechaza ofertas ajenas", (await call("PUT", `/driver-trip-offers/${second.data.id}/reject`, DRIVER.token)).status === 403);
check("Cliente rechaza la oferta", (await call("PUT", `/driver-trip-offers/${second.data.id}/reject`, CLIENT.token)).status === 200);
await wait(800);
check("Conductor recibe el rechazo", got("driver", `offer_status/${DRIVER.id}`, small));
check("Oferta rechazada ya no se lista", (await offersOf(small)).length === 0);

// 5. El conductor vuelve a ofertar y luego retira
const third = await offer(small, 31000);
check("Tras un rechazo se puede volver a ofertar", third.status === 201);
events.length = 0;
check("Conductor retira su oferta", (await call("PUT", `/driver-trip-offers/${third.data.id}/withdraw`, DRIVER.token)).status === 200);
await wait(800);
check("Cliente recibe el aviso de retiro", got("client", `created_driver_offer/${small}`, small));

// 6. Subir precio
check("Bajar el precio: 400", (await call("PUT", `/client-requests/${small}/fare`, CLIENT.token, { fare_offered: 20000 })).status === 400);
check("El conductor no sube el precio ajeno", (await call("PUT", `/client-requests/${small}/fare`, DRIVER.token, { fare_offered: 40000 })).status === 403);
check("Cliente sube el precio", (await call("PUT", `/client-requests/${small}/fare`, CLIENT.token, { fare_offered: 28000 })).status === 200);
await wait(800);
check("Conductores reciben el precio nuevo", got("driver", "client_request_updated", small));

// 7. "No me interesa"
const other = (await create()).data; created.push(other);
check("Conductor descarta una solicitud", (await call("POST", `/client-requests/${other}/dismiss`, DRIVER.token)).status === 200);
check("La descartada ya no aparece", !(await nearby()).some((r) => r.id === other));
check("Ofertar en una descartada: 409", (await offer(other, 30000)).status === 409);

// 8. Programado
const at = new Date(Date.now() + 3 * 3600000);
const sched = (await create({ scheduled_at: at.toISOString() })).data; created.push(sched);
const active = (await call("GET", "/client-requests/me/active", CLIENT.token)).data;
const schedRow = active.find((t) => t.id === sched);
check("Programado: cierra 30 min antes", schedRow && Math.abs(new Date(schedRow.expires_at) - (at - 30 * 60000)) < 2000, `${schedRow?.scheduled_at} / ${schedRow?.expires_at}`);

// 9. Viaje completo con el paso "Carga recogida"
await offer(small, 28000);
check("Cliente asigna", (await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: small, id_driver_assigned: DRIVER.id })).status === 200);
const driverActive = (await call("GET", "/client-requests/me/active", DRIVER.token)).data;
check("Aparece en los viajes activos del conductor", driverActive.some((t) => t.id === small && t.role === "DRIVER"));
const detail = (await call("GET", `/client-requests/${small}`, DRIVER.token)).data;
check("El conductor asignado ve quién recibe", detail.receiver_phone === "3001234567" && detail.receiver_name === "Ana Pérez");
const status = (s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id: small, status: s });
check("A camino", (await status("ON_THE_WAY")).status === 200);
check("Llegó", (await status("ARRIVED")).status === 200);
check("No se termina sin recoger la carga: 409", (await status("FINISHED")).status === 409);
await uploadPhoto(`/client-requests/${small}/photos`, DRIVER.token, { kind: "PICKUP" });
check("Carga recogida", (await status("TRAVELING")).status === 200);
check("Con la carga a bordo no se cancela: 409", (await call("PUT", `/client-requests/${small}/cancel`, CLIENT.token, { reason: "Ya no lo necesito" })).status === 409);
// Desde la Fase 5 el viaje se cierra con la foto de entrega y el código que solo ve el cliente
await uploadPhoto(`/client-requests/${small}/photos`, DRIVER.token, { kind: "DELIVERY" });
const { delivery_code } = (await call("GET", `/client-requests/${small}`, CLIENT.token)).data;
check("Termina el viaje con el código de entrega", (await call("POST", `/client-requests/${small}/deliver`, DRIVER.token, { code: delivery_code })).status === 200);

// 10. Cancelar con motivo después de asignar: avisa al conductor
const toCancel = (await create()).data; created.push(toCancel);
await offer(toCancel, 30000);
await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: toCancel, id_driver_assigned: DRIVER.id });
check("Cancelar sin motivo: 400", (await call("PUT", `/client-requests/${toCancel}/cancel`, CLIENT.token, { reason: "" })).status === 400);
events.length = 0;
const cancel = await call("PUT", `/client-requests/${toCancel}/cancel`, CLIENT.token, { reason: "Cambié de fecha" });
await wait(800);
check("Cliente cancela con motivo", cancel.status === 200 && cancel.data.canceled_by === "CLIENT");
check("Conductor recibe la cancelación", got("driver", `trip_canceled/${toCancel}`, toCancel));

// 11. Vencimiento: se adelanta la hora de vencimiento y el proceso de cada 30 s la cierra
const toExpire = (await create()).data; created.push(toExpire);
await offer(toExpire, 30000);
dbHelper("expire", toExpire);
events.length = 0;
let expired = false;
for (let i = 0; i < 40 && !expired; i++) { await wait(1000); expired = got("client", `client_request_expired/${toExpire}`, toExpire); }
check("Cliente recibe que la búsqueda venció", expired);
// El aviso a los conductores sale justo después del del cliente: se le da un momento para llegar
let removed = false;
for (let i = 0; i < 10 && !removed; i++) { removed = got("driver", "client_request_removed", toExpire); if (!removed) await wait(200); }
check("Conductores la sacan de la lista", removed);
check("Asignar una vencida: 400/409", [400, 409].includes((await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: toExpire, id_driver_assigned: DRIVER.id })).status));

// Limpieza: cancela lo que quedó abierto
for (const id of created) await call("PUT", `/client-requests/${id}/cancel`, CLIENT.token, { reason: "Limpieza de pruebas" });
clientSock.close();
driverSock.close();

finish(`Fletes de prueba: ${created.join(", ")}`);
