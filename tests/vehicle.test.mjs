// Cambiar de vehículo, capacidad real y renovar documentos. Uso: npm test
// Usa el conductor de prueba (vehículo de estacas) y al final le deja el vehículo y los documentos como estaban
import { call, createReport, testClient, testDriver } from "./support/api.mjs";

const { check, finish } = createReport();
const CLIENT = await testClient();
const DRIVER = await testDriver();
const DRIVER_POS = "4.6105/-74.1895";
const DAY = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY).toISOString();

const original = (await call("GET", `/driver-car-info/${DRIVER.id}`, DRIVER.token)).data;
const vehicleOf = (car) => ({
    vehicle_type: car.vehicle_type, brand: car.brand, color: car.color, plate: car.plate,
    model_year: car.model_year ?? 2020, is_covered: car.is_covered, capacity_kg: car.capacity_kg, capacity_m3: car.capacity_m3,
});
const updateVehicle = (body, token = DRIVER.token) => call("PUT", "/driver-car-info/me", token, body);
const updateDocuments = (body, token = DRIVER.token) => call("PUT", "/driver-car-info/me/documents", token, body);
const base = vehicleOf(original);

// 1. Datos del vehículo
check("El cliente no cambia vehículos: 403", (await updateVehicle(base, CLIENT.token)).status === 403);
check("Placa inválida: 400", (await updateVehicle({ ...base, plate: "12" })).status === 400);
check("Capacidad imposible para el tipo: 400", (await updateVehicle({ ...base, vehicle_type: "CARRY", capacity_m3: 40 })).status === 400);
const docs = { license_category: "C1", license_expires_at: future(900), soat_expires_at: future(200), techno_expires_at: future(100) };
check("Documentos con fecha vencida: 400", (await updateDocuments({ ...docs, soat_expires_at: future(-3) })).status === 400);
const renewed = await updateDocuments(docs);
check("Renueva los documentos y quedan vigentes", renewed.status === 200 && renewed.data.every((doc) => doc.status === "OK"), JSON.stringify(renewed.data));
check("Camión con licencia C1: 409", (await updateVehicle({ ...base, vehicle_type: "CAMION" })).status === 409);

// 2. Capacidad real: una carga de unos 13,6 m³ pide furgón; una camioneta de estacas típica no la ve
const bigCargo = {
    pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 60000,
    pickup_description: "Prueba capacidad origen", destination_description: "Prueba capacidad destino", cargo_description: "Prueba capacidad",
    weight_kg: 500, length_cm: 200, width_cm: 200, height_cm: 170, packages: 2, no_prohibited_items: true,
};
const created = [];
const createTrip = async (extra = {}) => { const id = (await call("POST", "/client-requests", CLIENT.token, { ...bigCargo, ...extra })).data; created.push(id); return id; };
const nearbyIds = async () => (await call("GET", `/client-requests/${DRIVER_POS}`, DRIVER.token)).data.map((r) => r.id);
const offer = (id) => call("POST", "/driver-trip-offers", DRIVER.token, { id_client_request: id, fare_offered: 65000, time: 5, distance: 1 });

check("Vuelve a estacas sin capacidad propia", (await updateVehicle({ ...base, vehicle_type: "ESTACAS", capacity_kg: null, capacity_m3: null })).status === 200);
const furgonTrip = await createTrip();
check("La carga grande pide furgón", (await call("GET", `/client-requests/${furgonTrip}`, CLIENT.token)).data.required_vehicle === "FURGON");
check("Estacas típica no la ve", !(await nearbyIds()).includes(furgonTrip));
check("Estacas típica no puede ofertar: 409", (await offer(furgonTrip)).status === 409);

const bigger = await updateVehicle({ ...base, vehicle_type: "ESTACAS", capacity_kg: 3000, capacity_m3: 18 });
check("Declara una estacas grande de 18 m³", bigger.status === 200 && bigger.data.capacity_m3 === 18);
check("Ahora ve la carga que le cabe", (await nearbyIds()).includes(furgonTrip));
check("Y puede ofertar", (await offer(furgonTrip)).status === 201);
const chosenTruck = await createTrip({ weight_kg: 50, length_cm: 80, width_cm: 50, height_cm: 50, packages: 1, vehicle_type: "CAMION" });
check("Si el cliente pidió camión a propósito, no la ve", !(await nearbyIds()).includes(chosenTruck));
check("El cliente ve la capacidad del vehículo", (await call("GET", `/driver-car-info/${DRIVER.id}`, CLIENT.token)).data.capacity_m3 === 18);

// Limpieza: cancela las solicitudes y deja el vehículo y los documentos como estaban
for (const id of created) await call("PUT", `/client-requests/${id}/cancel`, CLIENT.token, { reason: "Prueba de capacidad" });
check("Restaura el vehículo original", (await updateVehicle(base)).status === 200);
if (original.license_expires_at && new Date(original.license_expires_at) > new Date() && original.soat_expires_at && new Date(original.soat_expires_at) > new Date()) {
    const techno = original.techno_expires_at && new Date(original.techno_expires_at) > new Date() ? original.techno_expires_at : null;
    await updateDocuments({ license_category: original.license_category, license_expires_at: original.license_expires_at, soat_expires_at: original.soat_expires_at, techno_expires_at: techno });
}

finish(`Fletes de prueba: ${created.join(", ")}`);
