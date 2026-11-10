// Fase 9b: países y monedas. El país lo decide el backend con las coordenadas de recogida, el flete guarda su país
// y su moneda, y precios, comisión y pagos van en esa moneda con sus decimales. Uso: npm test
// El pago por la app usa el simulador (PAYMENTS_SIMULATOR=true y sin llaves de Wompi en el .env)
import { call, createReport, dbHelper, testClient, testDriver, uploadPhoto, wait } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const stamp = Date.now();

// Puntos de prueba: [lat, lng]
const BOGOTA = [4.61, -74.19];
const BOGOTA_DEST = [4.62, -74.14];
const PARIS = [48.8566, 2.3522];
const PARIS_DEST = [48.8738, 2.295];
const CDMX = [19.4326, -99.1332];
const CDMX_DEST = [19.4204, -99.1640];

const tripBody = ([lat, lng], [destLat, destLng], extra = {}) => ({
    pickup_lat: lat, pickup_lng: lng, destination_lat: destLat, destination_lng: destLng, fare_offered: 25000,
    pickup_description: "Prueba Fase 9b origen", destination_description: "Prueba Fase 9b destino", cargo_description: "Prueba Fase 9b",
    weight_kg: 30, length_cm: 60, width_cm: 40, height_cm: 40, no_prohibited_items: true, ...extra,
});
const createTrip = (from, to, extra) => call("POST", "/client-requests", CLIENT.token, tripBody(from, to, extra));
const detailOf = (id) => call("GET", `/client-requests/${id}`, CLIENT.token).then((r) => r.data);
const offer = (id, fare) => call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: fare, time: 5, distance: 1 });
const cancel = (id) => call("PUT", `/client-requests/${id}/cancel`, CLIENT.token, { reason: "Prueba de países" });
const at = ([lat, lng], token = CLIENT.token) => call("GET", `/countries/at/${lat}/${lng}`, token);
const toCancel = [];

// 1. Lista pública de países, con su moneda e indicativo
const countries = await call("GET", "/countries");
const byCode = Object.fromEntries((countries.data ?? []).map((c) => [c.code, c]));
check("Lista de países sin sesión: los 24, en los 5 continentes", countries.status === 200 && countries.data.length === 24, String(countries.data?.length));
check("8 monedas: COP, MXN, USD, EUR, BRL, AUD, INR y ZAR", [...new Set(countries.data?.map((c) => c.currency))].sort().join() === "AUD,BRL,COP,EUR,INR,MXN,USD,ZAR");
check("Colombia: COP, +57, sin decimales, paso de $1.000", byCode.CO?.currency === "COP" && byCode.CO.phone_prefix === "+57" && byCode.CO.decimals === 0 && byCode.CO.fare_step === 1000);
check("Francia: EUR con 2 decimales y paso de 1", byCode.FR?.currency === "EUR" && byCode.FR.decimals === 2 && byCode.FR.fare_step === 1);
check("Los nombres vienen en los 6 idiomas", ["es", "en", "fr", "it", "pt", "de"].every((lang) => byCode.DE?.names?.[lang]), JSON.stringify(byCode.DE?.names));
check("Cada país trae su idioma por defecto (Ecuador es, Bélgica fr, India en)", byCode.EC?.default_language === "es" && byCode.BE?.default_language === "fr" && byCode.IN?.default_language === "en");
check("Estados Unidos y Puerto Rico comparten el +1", byCode.US?.phone_prefix === "+1" && byCode.PR?.phone_prefix === "+1");

// 2. Detección del país por coordenadas, con las fronteras reales (Natural Earth 1:10m)
const detected = async (point) => (await at(point)).data;
const PLACES = [
    ["Bogotá", BOGOTA, "CO"], ["París", PARIS, "FR"], ["Ciudad de México", CDMX, "MX"],
    ["Tijuana (en la frontera)", [32.5149, -117.0382], "MX"], ["San Diego, al otro lado", [32.7157, -117.1611], "US"],
    ["Nueva York", [40.7128, -74.006], "US"], ["Barcelona", [41.3874, 2.1686], "ES"],
    ["Estrasburgo", [48.5734, 7.7521], "FR"], ["Kehl, al otro lado del Rin", [48.5728, 7.8106], "DE"],
    ["Quito", [-0.1807, -78.4678], "EC"], ["Guayaquil (en el estuario, por cercanía)", [-2.1894, -79.8862], "EC"],
    ["Ciudad de Panamá", [8.9824, -79.5199], "PA"], ["San Juan", [18.4655, -66.1057], "PR"],
    ["Bruselas", [50.8503, 4.3517], "BE"], ["Luxemburgo", [49.6116, 6.1296], "LU"], ["Mónaco", [43.7384, 7.4246], "MC"],
    ["Niza, junto a Mónaco", [43.7102, 7.262], "FR"], ["Andorra la Vella", [42.5063, 1.5218], "AD"],
    ["San Marino", [43.9424, 12.4578], "SM"], ["Viena", [48.2082, 16.3738], "AT"], ["Dublín", [53.3498, -6.2603], "IE"],
    ["La Valeta", [35.8989, 14.5146], "MT"], ["Sídney", [-33.8688, 151.2093], "AU"], ["Bombay", [19.076, 72.8777], "IN"],
    ["Johannesburgo", [-26.2041, 28.0473], "ZA"],
];
for (const [name, point, code] of PLACES) {
    const result = await detected(point);
    check(`${name} → ${code}`, result?.supported === true && result.code === code, `${result?.code} ${result?.method}`);
}
for (const [name, point] of [["Buenos Aires", [-34.6037, -58.3816]], ["Ámsterdam", [52.3676, 4.9041]], ["Caracas", [10.4806, -66.9036]], ["Ginebra (a 3,7 km de Francia)", [46.2044, 6.1432]]]) {
    const result = await detected(point);
    check(`${name} → no disponible (sin respaldo a Colombia)`, result?.supported === false && !result.code, JSON.stringify(result));
}
check("Detectar sin sesión: 401", (await at(PARIS, null)).status === 401);
check("Coordenadas imposibles: 400", (await call("GET", "/countries/at/123/-74", CLIENT.token)).status === 400);

// 3. Precio sugerido con las tarifas del país de la recogida
const quote = (from, to) => call("GET", `/client-requests/${from.join("/")}/${to.join("/")}?weight=30&size=0.1&vehicle=CARRY`, CLIENT.token);
const quoteCO = (await quote(BOGOTA, BOGOTA_DEST)).data;
const quoteFR = (await quote(PARIS, PARIS_DEST)).data;
check("Cotización en Bogotá: en pesos, como antes", quoteCO?.country?.currency === "COP" && quoteCO.recommended_value > 15000, `${quoteCO?.recommended_value} ${quoteCO?.country?.currency}`);
check("Cotización en París: en euros y con un valor de euros (no de pesos)", quoteFR?.country?.currency === "EUR" && quoteFR.recommended_value > 20 && quoteFR.recommended_value < 200, `${quoteFR?.recommended_value} ${quoteFR?.country?.currency}`);
check("La cotización trae el paso y los límites de la moneda", quoteFR?.country?.fare_step === 1 && quoteFR.country.min_fare === 5);

const AMSTERDAM = [52.3676, 4.9041];
const BUENOS_AIRES = [-34.6037, -58.3816];
const quoteNL = await quote(AMSTERDAM, [52.37, 4.95]);
check("Cotizar en Ámsterdam: 422 COUNTRY_NOT_SUPPORTED", quoteNL.status === 422 && quoteNL.data?.key === "COUNTRY_NOT_SUPPORTED", `${quoteNL.status} ${quoteNL.data?.key}`);
const tripAR = await createTrip(BUENOS_AIRES, [-34.61, -58.42], { fare_offered: 30 });
check("Pedir un flete en Buenos Aires: 422, no se crea", tripAR.status === 422 && tripAR.data?.code === "COUNTRY_NOT_SUPPORTED", `${tripAR.status} ${JSON.stringify(tripAR.data)}`);
check("El mensaje dice dónde sí operamos", /Colombia/.test(tripAR.data?.params?.countries ?? "") && /Sudáfrica/.test(tripAR.data.params.countries), tripAR.data?.message);

// 4. El flete guarda país y moneda, y los límites del precio son los de su moneda
const tooCheap = await createTrip(PARIS, PARIS_DEST, { fare_offered: 3 });
check("En euros, 3 € es muy poco: 400 FARE_MIN", tooCheap.status === 400 && tooCheap.data?.key === "FARE_MIN", `${tooCheap.status} ${tooCheap.data?.key} ${tooCheap.data?.params?.min}`);
const tooHigh = await createTrip(PARIS, PARIS_DEST, { fare_offered: 25000 });
check("En euros, 25.000 € (un precio en pesos) es demasiado: 400 FARE_MAX", tooHigh.status === 400 && tooHigh.data?.key === "FARE_MAX");
const parisCreated = await createTrip(PARIS, PARIS_DEST, { fare_offered: 25.555, sender_name: "Marie", sender_phone: "612345678" });
const parisId = parisCreated.data;
const paris = await detailOf(parisId);
check("Flete en París: guarda FR y EUR", parisCreated.status === 201 && paris?.country_code === "FR" && paris.currency === "EUR", `${parisCreated.status} ${paris?.country_code} ${paris?.currency}`);
check("El precio en euros se redondea a centavos (25,555 → 25,56)", paris?.fare_offered === 25.56, String(paris?.fare_offered));
check("Las coordenadas vuelven como se mandaron (lng en x, lat en y)", Math.abs(paris?.pickup_position?.x - PARIS[1]) < 1e-6 && Math.abs(paris?.pickup_position?.y - PARIS[0]) < 1e-6, JSON.stringify(paris?.pickup_position));
const coPhoneInParis = await createTrip(PARIS, PARIS_DEST, { fare_offered: 30, receiver_name: "Ana", receiver_phone: "3001234567" });
check("Un celular colombiano no sirve para un flete en Francia: 400 PHONE_FORMAT", coPhoneInParis.status === 400 && coPhoneInParis.data?.key === "PHONE_FORMAT", `${coPhoneInParis.status} ${coPhoneInParis.data?.key}`);

const bogotaCreated = await createTrip(BOGOTA, BOGOTA_DEST, { fare_offered: 25000.4 });
const bogotaId = bogotaCreated.data;
const bogota = await detailOf(bogotaId);
check("Flete en Bogotá: CO, COP y sin centavos", bogota?.country_code === "CO" && bogota.currency === "COP" && bogota.fare_offered === 25000, `${bogota?.currency} ${bogota?.fare_offered}`);
check("En pesos, $3 sigue siendo muy poco: 400", (await createTrip(BOGOTA, BOGOTA_DEST, { fare_offered: 3 })).status === 400);
check("En pesos, el celular de quien entrega sigue pidiendo 10 dígitos con 3", (await createTrip(BOGOTA, BOGOTA_DEST, { sender_name: "Ana", sender_phone: "612345678" })).data?.key === "PHONE_FORMAT");
toCancel.push(bogotaId);

const cdmx = await createTrip(CDMX, CDMX_DEST, { fare_offered: 450 });
check("Flete en Ciudad de México (longitud −99): se crea en MXN", cdmx.status === 201 && (await detailOf(cdmx.data))?.currency === "MXN", `${cdmx.status} ${JSON.stringify(cdmx.data)}`);
toCancel.push(cdmx.data);

// 5. Distancia real entre el conductor y la recogida (con los ejes bien)
const fiveKmNorth = [BOGOTA[0] + 0.045, BOGOTA[1]];
const nearby = (await call("GET", `/client-requests/${fiveKmNorth[0]}/${fiveKmNorth[1]}`, DRIVER.token)).data ?? [];
const seen = nearby.find((item) => item.id === bogotaId);
check("El conductor a 5 km al norte ve el flete a ~5 km (antes salía 1,4 km)", seen && seen.distance > 4800 && seen.distance < 5200, `${seen?.distance}`);
check("La lista del conductor trae la moneda de cada flete", seen?.currency === "COP");

// 6. Subir el precio y ofertar, en la moneda del flete
const raised = await call("PUT", `/client-requests/${parisId}/fare`, CLIENT.token, { fare_offered: 27.5 });
check("Subir a 27,50 €", raised.status === 200 && raised.data.fare_offered === 27.5 && raised.data.currency === "EUR", JSON.stringify(raised.data));
check("Oferta de 2 € en un flete en euros: 400", (await offer(parisId, 2)).status === 400);
const parisOffer = await offer(parisId, 30.5);
check("Oferta de 30,50 €", parisOffer.status === 201 || parisOffer.status === 200, `${parisOffer.status} ${JSON.stringify(parisOffer.data?.message)}`);
const assigned = await call("PUT", "/client-requests/updateDriverAssigned", CLIENT.token, { id: parisId, id_driver_assigned: DRIVER.id });
const parisAssigned = await detailOf(parisId);
check("Al asignar, la comisión se calcula en euros con centavos (10 % de 30,50 = 3,05)", assigned.status === 200 && parisAssigned?.commission === 3.05 && parisAssigned.fare_assigned === 30.5, `${parisAssigned?.fare_assigned} ${parisAssigned?.commission}`);

// 7. Pago por el simulador en euros: el monto y la moneda tienen que coincidir
const status = (id, s) => call("PUT", "/client-requests/update_status", DRIVER.token, { id, status: s });
const photo = (id, kind) => uploadPhoto(`/client-requests/${id}/photos`, DRIVER.token, { kind });
await status(parisId, "ON_THE_WAY");
await status(parisId, "ARRIVED");
await photo(parisId, "PICKUP");
await status(parisId, "TRAVELING");
await photo(parisId, "DELIVERY");
const delivered = await call("POST", `/client-requests/${parisId}/deliver`, DRIVER.token, { code: parisAssigned.delivery_code });
check("Entrega con el código", delivered.status === 200, `${delivered.status}`);
const payStatus = (await call("GET", `/client-requests/${parisId}/payment`, CLIENT.token)).data;
check("El pago se muestra en euros: 30,50 €", payStatus?.currency === "EUR" && payStatus.amount === 30.5, JSON.stringify({ c: payStatus?.currency, a: payStatus?.amount }));
const started = await call("POST", `/client-requests/${parisId}/payment/online`, CLIENT.token);
check("El simulador acepta pagos en euros", started.status === 201 && started.data.currency === "EUR" && started.data.amount === 30.5, `${started.status} ${JSON.stringify(started.data)}`);
const checkoutUrl = started.data?.checkout_url;
const page = checkoutUrl ? await fetch(checkoutUrl).then((r) => r.text()).catch(() => "") : "";
check("La página del simulador muestra EUR 30,50", /EUR\s30,50/.test(page));
if (checkoutUrl) {
    await fetch(checkoutUrl, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ method: "CARD", card_number: "4242424242424242", expiry: "12/39", cvc: "123", holder: "Prueba Fase Nueve" }).toString(),
    });
    await wait(3000);
}
const verified = await call("POST", `/client-requests/${parisId}/payment/online/verify`, CLIENT.token);
check("El pago en euros se aprueba (monto en centavos y moneda coinciden)", verified.data?.paid_at && verified.data.last_payment?.status === "APPROVED", JSON.stringify(verified.data?.last_payment));

// 8. País de la cuenta: indicativo, placa y licencia según el país
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString();
const vehicle = (plate, license_category = "B", vehicle_type = "CARRY") => ({
    vehicle_type, brand: "Renault Kangoo", color: "Blanco", plate, model_year: 2021, is_covered: true,
    license_number: "FR12345678", license_category, license_expires_at: nextYear, soat_expires_at: nextYear, techno_expires_at: nextYear,
    property_card_number: "CG-998877",
});
const emails = { client: `fr-cliente${stamp}@prueba.com`, driver: `fr-conductor${stamp}@prueba.com`, co: `co-conductor${stamp}@prueba.com`, bad: `xx${stamp}@prueba.com` };
const frClient = await call("POST", "/auth/register", null, { name: "Claire", lastname: "Prueba", email: emails.client, phone: "612345678", password: "123456", country_code: "FR" });
check("Registro con país Francia: la cuenta queda en FR", frClient.status === 200 && frClient.data?.user?.country_code === "FR", `${frClient.status} ${frClient.data?.user?.country_code}`);
check("Registro sin país (app vieja): queda en Colombia", (await call("POST", "/auth/register", null, { name: "Viejo", lastname: "Prueba", email: emails.bad, phone: "3001234567", password: "123456" })).data?.user?.country_code === "CO");
check("País inventado: 400", (await call("POST", "/auth/register", null, { name: "Otro", lastname: "Prueba", email: `x${emails.bad}`, phone: "3001234567", password: "123456", country_code: "XX" })).status === 400);
const plate = `AB${String(stamp).slice(-3)}CD`;
const frDriver = await call("POST", "/auth/register-driver", null, { name: "Luc", lastname: "Prueba", email: emails.driver, phone: "698765432", password: "123456", country_code: "FR", vehicle: vehicle(`${plate.slice(0, 2)}-${plate.slice(2, 5)}-${plate.slice(5)}`, "C", "CAMION") });
const frCar = frDriver.data?.user?.id ? (await call("GET", `/driver-car-info/${frDriver.data.user.id}`, frDriver.data.token)).data : null;
check("Conductor en Francia: placa AB-123-CD aceptada (sin guiones) y licencia C para camión", frDriver.status === 200 && frCar?.plate === plate, `${frDriver.status} ${JSON.stringify(frDriver.data?.message)} ${frCar?.plate}`);
const coDriver = await call("POST", "/auth/register-driver", null, { name: "Juan", lastname: "Prueba", email: emails.co, phone: "3005556677", password: "123456", country_code: "CO", vehicle: vehicle(`ZX${String(stamp).slice(-3)}CD`) });
check("En Colombia la placa sigue siendo ABC123: 400 PLATE_FORMAT", coDriver.status === 400 && coDriver.data?.key === "PLATE_FORMAT", `${coDriver.status} ${coDriver.data?.key}`);
const coTruck = await call("POST", "/auth/register-driver", null, { name: "Juan", lastname: "Prueba", email: emails.co, phone: "3005556677", password: "123456", vehicle: vehicle(`ZXC${String(stamp).slice(-3)}`, "B1", "CAMION") });
check("En Colombia un camión sigue pidiendo licencia B2/C2: 400", coTruck.status === 400 && coTruck.data?.key === "TRUCK_NEEDS_LICENSE", `${coTruck.status} ${coTruck.data?.key}`);
const coLicense = await call("POST", "/auth/register-driver", null, { name: "Juan", lastname: "Prueba", email: emails.co, phone: "3005556677", password: "123456", vehicle: vehicle(`ZXC${String(stamp).slice(-3)}`, "C") });
check("En Colombia la categoría C sola no existe: 400", coLicense.status === 400 && coLicense.data?.key === "LICENSE_CATEGORY_INVALID", `${coLicense.status} ${coLicense.data?.key}`);
const moved = await call("PUT", `/users/upload/${frClient.data?.user?.id}`, frClient.data?.token, { phone: "3001112233", country_code: "CO" });
check("Cambiar el indicativo en el perfil cambia el país", moved.data?.country_code === "CO", `${moved.status} ${moved.data?.country_code}`);

// Limpieza: los fletes que quedaron buscando y las cuentas de prueba
for (const id of toCancel) await cancel(id);
dbHelper("delete", ...Object.values(emails), `x${emails.bad}`);
finish();
