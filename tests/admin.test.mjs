// Panel de administración (Fase 8): sesión propia con cookie, verificación de conductores, suspensión inmediata,
// tarifas, viajes, comisiones y registro de acciones. Crea cuentas @prueba.com y las borra al final. Uso: npm test
import { API, call, connectSocket, createReport, dbHelper, testClient } from "./support/api.mjs";

const { check, finish } = createReport();
const stamp = Date.now();
const ADMIN_EMAIL = `admin${stamp}@prueba.com`;
const DRIVER_EMAIL = `nuevo${stamp}@prueba.com`;
const CLIENT_EMAIL = `cliente${stamp}@prueba.com`;
const GONE_EMAIL = `borrar${stamp}@prueba.com`;
const PASSWORD = "admin123";

const register = (email) => call("POST", "/auth/register", null, { name: "Prueba", lastname: "Panel", email, phone: "3001234567", password: PASSWORD });
const CLIENT = await testClient();

// Sesión del panel: la cookie que devuelve /admin/api/login y el encabezado que piden los cambios
let cookie = "";
const admin = async (method, path, body, { withHeader = true } = {}) => {
    const res = await fetch(`${API}/admin/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie, ...(withHeader && method !== "GET" ? { "X-FleteYa-Admin": "1" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
};

// 1. Entrar al panel
await register(ADMIN_EMAIL);
const plain = await register(CLIENT_EMAIL);
dbHelper("grant-admin", ADMIN_EMAIL);
check("Sin sesión no hay datos: 401", (await admin("GET", "/stats")).status === 401);
const appToken = plain.data.token;
const withAppToken = await fetch(`${API}/admin/api/stats`, { headers: { Authorization: appToken } });
check("El token de la app no abre el panel: 401", withAppToken.status === 401);
check("Cuenta sin rol ADMIN: 401", (await admin("POST", "/login", { email: CLIENT_EMAIL, password: PASSWORD })).status === 401);
check("Contraseña equivocada: 401", (await admin("POST", "/login", { email: ADMIN_EMAIL, password: "malmal" })).status === 401);
const login = await admin("POST", "/login", { email: ADMIN_EMAIL, password: PASSWORD });
cookie = (login.setCookie ?? "").split(";")[0];
check("Admin entra al panel", login.status === 200 && cookie.startsWith("fy_admin="), `${login.status}`);
check("La cookie es httpOnly, SameSite=Strict y solo para /admin",
    /HttpOnly/i.test(login.setCookie ?? "") && /SameSite=Strict/i.test(login.setCookie ?? "") && /Path=\/admin/i.test(login.setCookie ?? ""));
check("La cookie del panel no sirve como token de la app: 401",
    (await call("GET", "/client-requests/me/active", `Bearer ${decodeURIComponent(cookie.split("=")[1])}`)).status === 401);

// 2. Estadísticas
const stats = await admin("GET", "/stats?days=30");
check("Estadísticas con datos reales", stats.status === 200 && stats.data.users.clients > 0 && Array.isArray(stats.data.trips.per_day)
    && typeof stats.data.money.commission === "number", `${stats.status}`);

// 3. Verificación de conductores: se quita la aprobación automática
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString();
const plate = `PN${String(stamp).slice(-4, -3)}${String(stamp).slice(-3)}`.replace(/^(..)(\d)/, (_, a) => a + "L");
const reg = await call("POST", "/auth/register-driver", null, {
    name: "Nuevo", lastname: "Conductor", email: DRIVER_EMAIL, phone: "3005556677", password: PASSWORD,
    vehicle: { vehicle_type: "CARRY", brand: "Suzuki Carry", color: "Blanco", plate, model_year: 2020, is_covered: false,
        license_number: "1019988776", license_category: "B1", license_expires_at: nextYear, soat_expires_at: nextYear, techno_expires_at: nextYear,
        property_card_number: "10009988776" },
});
const NEW_DRIVER = { id: reg.data?.user?.id, token: reg.data?.token };
const goAvailable = () => call("POST", "/drivers-position", NEW_DRIVER.token, { lat: 4.61, lng: -74.19 });
const pending = await goAvailable();
check("Conductor nuevo queda en revisión: no se pone disponible (403)", pending.status === 403 && pending.data.code === "DRIVER_NOT_APPROVED", `${pending.status} ${pending.data?.code}`);
check("En revisión no ve solicitudes: 403", (await call("GET", "/client-requests/4.61/-74.19", NEW_DRIVER.token)).status === 403);
const myCar = await call("GET", `/driver-car-info/${NEW_DRIVER.id}`, NEW_DRIVER.token);
check("La app recibe el motivo para mostrarlo", myCar.data?.approval_status === "PENDING" && /revisión/.test(myCar.data?.block_reason ?? ""));
const queue = await admin("GET", "/drivers?approval=PENDING");
check("El panel lo lista entre los pendientes", queue.data?.some?.((d) => d.id_driver === NEW_DRIVER.id));
const review = await admin("GET", `/drivers/${NEW_DRIVER.id}`);
check("Detalle con vehículo y documentos", review.status === 200 && review.data.vehicle.plate === plate && review.data.documents.length === 3);
check("Rechazar pide el motivo: 400", (await admin("PUT", `/drivers/${NEW_DRIVER.id}/reject`, { note: "" })).status === 400);
check("Rechaza con motivo", (await admin("PUT", `/drivers/${NEW_DRIVER.id}/reject`, { note: "La foto no deja ver la placa" })).status === 200);
const rejected = await goAvailable();
check("Rechazado ve el motivo", rejected.status === 403 && /placa/.test(rejected.data.message), rejected.data?.message);
const fix = await call("PUT", "/driver-car-info/me", NEW_DRIVER.token, { vehicle_type: "CARRY", brand: "Suzuki Carry", color: "Blanco", plate, model_year: 2020, is_covered: false });
check("Al corregir sus datos vuelve a revisión", fix.status === 200 && fix.data.approval_status === "PENDING", `${fix.status} ${fix.data?.approval_status}`);
check("Aprueba al conductor", (await admin("PUT", `/drivers/${NEW_DRIVER.id}/approve`)).status === 200);
check("Aprobado ya se pone disponible", (await goAvailable()).status === 201);
await call("DELETE", `/drivers-position/${NEW_DRIVER.id}`, NEW_DRIVER.token);

// 4. Protección de los cambios
check("Un cambio sin el encabezado del panel: 403", (await admin("PUT", `/drivers/${NEW_DRIVER.id}/approve`, null, { withHeader: false })).status === 403);
check("Id no válido: 400", (await admin("GET", "/users/abc")).status === 400);

// 5. Suspender corta al instante (API, socket e inicio de sesión) y reactivar lo devuelve
const SUSPENDED = { id: plain.data.user.id, token: appToken };
const socket = await connectSocket(SUSPENDED.token);
const kicked = new Promise((resolve) => {
    socket.on("account_suspended", () => resolve("aviso"));
    socket.on("disconnect", () => resolve("desconectado"));
    setTimeout(() => resolve("nada"), 3000);
});
check("Suspender pide el motivo: 400", (await admin("PUT", `/users/${SUSPENDED.id}/suspend`, { reason: "" })).status === 400);
check("Suspende la cuenta", (await admin("PUT", `/users/${SUSPENDED.id}/suspend`, { reason: "Pruebas del panel" })).status === 200);
check("El socket de la cuenta se cierra", (await kicked) !== "nada");
socket.close();
const blocked = await call("GET", "/client-requests/me/active", SUSPENDED.token);
check("Su siguiente petición: 403 ACCOUNT_SUSPENDED", blocked.status === 403 && blocked.data.code === "ACCOUNT_SUSPENDED", `${blocked.status} ${blocked.data?.code}`);
const relogin = await call("POST", "/auth/login", null, { email: CLIENT_EMAIL, password: PASSWORD });
check("No puede volver a entrar y ve el motivo", relogin.status === 403 && /Pruebas del panel/.test(relogin.data.message), `${relogin.status}`);
check("Tampoco conecta el socket", await connectSocket(SUSPENDED.token).then((s) => { s.close(); return false; }, () => true));
check("No se puede suspender la propia cuenta: 409", (await admin("PUT", `/users/${login.data.id}/suspend`, { reason: "Probando a mí mismo" })).status === 409);
check("Reactiva la cuenta", (await admin("PUT", `/users/${SUSPENDED.id}/reactivate`)).status === 200);
check("Reactivada vuelve a usar la app", (await call("GET", "/client-requests/me/active", SUSPENDED.token)).status === 200);
const found = await admin("GET", `/users?q=${encodeURIComponent(CLIENT_EMAIL)}`);
check("Buscar usuarios por correo", found.data?.items?.length === 1 && found.data.items[0].id === SUSPENDED.id);

// 6. Anonimizar a pedido del usuario
const gone = await register(GONE_EMAIL);
const GONE_ID = gone.data.user.id;
check("Anonimiza la cuenta", (await admin("POST", `/users/${GONE_ID}/anonymize`)).status === 200);
const goneDetail = await admin("GET", `/users/${GONE_ID}`);
check("Ya no tiene nombre, correo ni celular", goneDetail.data?.email === `eliminado-${GONE_ID}@fleteya.invalid` && goneDetail.data.phone === "" && goneDetail.data.anonymized_at);
check("Su sesión ya no sirve: 401", (await call("GET", "/client-requests/me/active", gone.data.token)).status === 401);
check("No se anonimiza dos veces: 409", (await admin("POST", `/users/${GONE_ID}/anonymize`)).status === 409);

// 7. Tarifas y comisión sin entrar a la base
const rates = (await admin("GET", "/config")).data;
check("Tarifas actuales con los 4 vehículos", rates?.vehicle_rates?.length === 4 && rates.commission_rate > 0);
const { vehicle_rates, ...fares } = rates;
check("Comisión de 90 %: 400", (await admin("PUT", "/config", { ...fares, vehicle_rates, commission_rate: 0.9 })).status === 400);
const quote = () => call("GET", "/client-requests/4.61/-74.19/4.62/-74.14?weight=50&size=0.2&vehicle=CARRY", CLIENT.token).then((r) => r.data?.recommended_value);
const before = await quote();
const changed = await admin("PUT", "/config", { ...fares, km_value: fares.km_value + 500, vehicle_rates });
check("Cambia el valor por km", changed.status === 200 && changed.data.km_value === fares.km_value + 500);
const after = await quote();
check("El precio sugerido usa la tarifa nueva", after > before, `${before} → ${after}`);
check("Vuelve a la tarifa anterior", (await admin("PUT", "/config", { ...fares, vehicle_rates })).data?.km_value === fares.km_value);

// 8. Viajes atascados y comisiones
const tripId = (await call("POST", "/client-requests", CLIENT.token, {
    pickup_lat: 4.61, pickup_lng: -74.19, destination_lat: 4.62, destination_lng: -74.14, fare_offered: 25000,
    pickup_description: "Prueba Fase 8 origen", destination_description: "Prueba Fase 8 destino", cargo_description: "Prueba Fase 8",
    weight_kg: 50, length_cm: 80, width_cm: 50, height_cm: 50, no_prohibited_items: true,
})).data;
const tripDetail = await admin("GET", `/trips/${tripId}`);
check("Detalle del viaje con cliente y ofertas", tripDetail.status === 200 && tripDetail.data.client?.id === CLIENT.id && Array.isArray(tripDetail.data.offers));
check("Cierra el viaje", (await admin("PUT", `/trips/${tripId}/cancel`, { reason: "Prueba del panel" })).status === 200);
check("Un viaje cerrado no se cierra otra vez: 409", (await admin("PUT", `/trips/${tripId}/cancel`, { reason: "Prueba del panel" })).status === 409);
check("Listado de viajes filtra por estado", (await admin("GET", "/trips?status=CANCELED")).data?.items?.some?.((t) => t.id === tripId));
check("Comisiones en efectivo por conductor", Array.isArray((await admin("GET", "/commissions")).data));
check("Liquidar sin pendientes: 409", (await admin("POST", `/commissions/${NEW_DRIVER.id}/settle`)).status === 409);
check("Pagos paginados", Array.isArray((await admin("GET", "/payments")).data?.items));
check("Incidentes", Array.isArray((await admin("GET", "/incidents?status=OPEN")).data));

// 9. Registro de acciones
const log = (await admin("GET", "/audit")).data?.items ?? [];
const did = (action, id) => log.some((row) => row.action === action && (id === undefined || row.target_id === id));
check("El registro guarda cada acción",
    did("SUSPEND_USER", SUSPENDED.id) && did("REACTIVATE_USER", SUSPENDED.id) && did("APPROVE_DRIVER", NEW_DRIVER.id)
    && did("REJECT_DRIVER", NEW_DRIVER.id) && did("ANONYMIZE_USER", GONE_ID) && did("UPDATE_RATES") && did("CANCEL_TRIP", tripId));

// 10. Salir
const out = await admin("POST", "/logout");
check("Salir borra la cookie", out.status === 200 && /fy_admin=;/.test(out.setCookie ?? ""));

dbHelper("delete", ADMIN_EMAIL, DRIVER_EMAIL, CLIENT_EMAIL);
dbHelper("delete-anonymized", GONE_ID);
finish(`Flete de prueba: ${tripId}`);
