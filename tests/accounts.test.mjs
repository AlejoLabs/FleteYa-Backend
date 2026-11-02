// Cuentas: registro de conductor, licencias, restablecer y cambiar contraseña, y cuentas de Google. Uso: npm test
// Crea cuentas @prueba.com con contraseñas de prueba y las borra al final
import { API, call as apiCall, createReport, dbHelper } from "./support/api.mjs";

const { check, finish } = createReport();
const call = (method, path, body) => apiCall(method, path, null, body);
const helper = dbHelper;

const stamp = Date.now();
const DRIVER_EMAIL = `conductor${stamp}@prueba.com`;
const GOOGLE_EMAIL = `google${stamp}@prueba.com`;
const plate = `ZX${String(stamp).slice(-4, -3)}${String(stamp).slice(-3)}`.replace(/^(..)(\d)/, (_, a) => a + "Q"); // 3 letras + 3 números
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString();
const vehicle = { vehicle_type: "ESTACAS", brand: "Chevrolet NHR", color: "Blanco", plate, model_year: 2019, is_covered: false,
  license_number: "1012345678", license_category: "C1", license_expires_at: nextYear, soat_expires_at: nextYear, techno_expires_at: nextYear,
  property_card_number: "10002345678" };
const account = { name: "Pedro", lastname: "Prueba", email: DRIVER_EMAIL, phone: "3001112233", password: "123456" };

// 1. Validaciones del registro de conductor
check("Placa inválida: 400", (await call("POST", "/auth/register-driver", { ...account, vehicle: { ...vehicle, plate: "12AB" } })).status === 400);
check("SOAT vencido: 400", (await call("POST", "/auth/register-driver", { ...account, vehicle: { ...vehicle, soat_expires_at: "2024-01-01" } })).status === 400);
const heavy = await call("POST", "/auth/register-driver", { ...account, vehicle: { ...vehicle, vehicle_type: "CAMION", license_category: "B1" } });
check("Camión con licencia B1: 400", heavy.status === 400, JSON.stringify(heavy.data?.message));

// 2. Registro correcto: rol de conductor y vehículo aprobado
const reg = await call("POST", "/auth/register-driver", { ...account, email: `  ${DRIVER_EMAIL.toUpperCase()} `, vehicle: { ...vehicle, plate: plate.toLowerCase().replace(/(...)/, "$1-") } });
const roles = reg.data?.user?.roles?.map((r) => r.id) ?? [];
check("Conductor registrado con rol DRIVER", reg.status === 200 && roles.length === 1 && roles[0] === "DRIVER", `${reg.status} ${JSON.stringify(reg.data?.message ?? roles)}`);
check("El correo se guarda en minúsculas", reg.data?.user?.email === DRIVER_EMAIL);
check("La respuesta no trae la contraseña ni el id de Google", reg.data?.user && !("password" in reg.data.user) && !("google_id" in reg.data.user));
const car = await fetch(`${API}/driver-car-info/${reg.data?.user?.id}`, { headers: { Authorization: reg.data?.token } }).then((r) => r.json());
// Desde la Fase 8 el conductor nuevo espera la verificación del admin (se prueba en admin.test.mjs)
check("Vehículo guardado: estacas, placa normalizada y en revisión", car.vehicle_type === "ESTACAS" && car.plate === plate && car.approval_status === "PENDING", `${car.vehicle_type} ${car.plate} ${car.approval_status}`);

// 3. Duplicados
check("Misma placa con otro conductor: 409", (await call("POST", "/auth/register-driver", { ...account, email: `otro${stamp}@prueba.com`, vehicle })).status === 409);
const dupEmail = await call("POST", "/auth/register", account);
check("Correo ya registrado: 409 con mensaje claro", dupEmail.status === 409, dupEmail.data?.message);

// 4. Login
check("Login con el correo en mayúsculas", (await call("POST", "/auth/login", { email: DRIVER_EMAIL.toUpperCase(), password: "123456" })).status === 200);

// 5. Olvidé mi contraseña
const unknown = await call("POST", "/auth/forgot-password", { email: `nadie${stamp}@prueba.com` });
const known = await call("POST", "/auth/forgot-password", { email: DRIVER_EMAIL });
check("Misma respuesta exista o no el correo", unknown.status === 200 && known.status === 200 && unknown.data.message === known.data.message);
check("Código de 5 dígitos rechazado: 400", (await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "12345", password: "nueva123" })).status === 400);
check("Código equivocado: 400", (await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "000000", password: "nueva123" })).status === 400);
helper("code", DRIVER_EMAIL, "424242");
check("Código correcto cambia la contraseña", (await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "424242", password: "nueva123" })).status === 200);
check("Entra con la contraseña nueva", (await call("POST", "/auth/login", { email: DRIVER_EMAIL, password: "nueva123" })).status === 200);
check("La contraseña vieja ya no sirve", (await call("POST", "/auth/login", { email: DRIVER_EMAIL, password: "123456" })).status === 401);
check("El código no se puede reutilizar", (await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "424242", password: "otra1234" })).status === 400);

// 6. Intentos limitados: tras 5 fallos ni el código correcto sirve
helper("code", DRIVER_EMAIL, "777777");
for (let i = 0; i < 5; i++) await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "111111", password: "otra1234" });
check("Tras 5 intentos fallidos el código queda bloqueado", (await call("POST", "/auth/reset-password", { email: DRIVER_EMAIL, code: "777777", password: "otra1234" })).status === 400);

// 7. Cuentas de Google
helper("google-user", GOOGLE_EMAIL);
const googleLogin = await call("POST", "/auth/login", { email: GOOGLE_EMAIL, password: "123456" });
check("Cuenta de Google sin contraseña: el login lo explica", googleLogin.status === 401 && /Google/.test(googleLogin.data?.message), googleLogin.data?.message);
const googleReg = await call("POST", "/auth/register", { ...account, email: GOOGLE_EMAIL });
check("Registrarse con un correo de Google: 409 'entra con Google'", googleReg.status === 409 && /Google/.test(googleReg.data?.message), googleReg.data?.message);
helper("code", GOOGLE_EMAIL, "135790");
check("La cuenta de Google crea su contraseña con el código", (await call("POST", "/auth/reset-password", { email: GOOGLE_EMAIL, code: "135790", password: "clave123" })).status === 200);
check("Y ya entra con correo y contraseña", (await call("POST", "/auth/login", { email: GOOGLE_EMAIL, password: "clave123" })).status === 200);
const badToken = await call("POST", "/auth/google", { id_token: "x".repeat(40) });
check("Token de Google falso rechazado", [401, 503].includes(badToken.status), `${badToken.status} ${badToken.data?.message}`);

// 8. Furgón liviano (tipo NHR) con licencia C1
const VAN_EMAIL = `furgon${stamp}@prueba.com`;
const van = await call("POST", "/auth/register-driver", { ...account, email: VAN_EMAIL, vehicle: { ...vehicle, vehicle_type: "FURGON", license_category: "C1", plate: `FUR${String(stamp).slice(-3)}` } });
check("Furgón con licencia C1 se registra", van.status === 200, `${van.status} ${JSON.stringify(van.data?.message ?? "")}`);

// 9. Cambiar la contraseña con la sesión abierta
const session = (await call("POST", "/auth/login", { email: DRIVER_EMAIL, password: "nueva123" })).data.token;
const change = (body) => fetch(`${API}/auth/password`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: session }, body: JSON.stringify(body) }).then((r) => r.status);
check("Sin sesión no se cambia: 401", (await call("PUT", "/auth/password", { current_password: "nueva123", new_password: "otra4567" })).status === 401);
check("Con la contraseña actual equivocada: 400", (await change({ current_password: "malmal", new_password: "otra4567" })) === 400);
check("La nueva igual a la actual: 400", (await change({ current_password: "nueva123", new_password: "nueva123" })) === 400);
check("Cambia la contraseña", (await change({ current_password: "nueva123", new_password: "otra4567" })) === 200);
check("Entra con la contraseña cambiada", (await call("POST", "/auth/login", { email: DRIVER_EMAIL, password: "otra4567" })).status === 200);

helper("delete", DRIVER_EMAIL, GOOGLE_EMAIL, VAN_EMAIL);

finish();
