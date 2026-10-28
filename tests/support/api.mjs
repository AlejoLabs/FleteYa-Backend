// Utilidades compartidas por las pruebas de integración. Necesitan el backend corriendo (npm run dev)
// y leen del .env la dirección del servidor y las cuentas de prueba
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { io } from "socket.io-client";

const missing = ["TEST_CLIENT_EMAIL", "TEST_DRIVER_EMAIL", "TEST_PASSWORD"].filter((name) => !process.env[name]);
if (missing.length) {
    console.error(`Faltan en el .env: ${missing.join(", ")}. Mira .env.example`);
    process.exit(1);
}

export const API = `http://${process.env.HOST ?? "localhost"}:${process.env.PORT ?? 3000}`;
export const TEST_PASSWORD = process.env.TEST_PASSWORD;

const BACKEND_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DB_HELPER = fileURLToPath(new URL("./db-helper.mts", import.meta.url));

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const call = async (method, path, token, body) => {
    const res = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
};

// Inicia sesión y devuelve el id y el token de la cuenta
export const login = async (email, password = TEST_PASSWORD) => {
    const { status, data } = await call("POST", "/auth/login", null, { email, password });
    if (status !== 200) throw new Error(`No se pudo entrar con ${email}: ${status} ${JSON.stringify(data?.message)}`);
    return { id: data.user.id, token: data.token };
};

export const testClient = () => login(process.env.TEST_CLIENT_EMAIL);
export const testDriver = () => login(process.env.TEST_DRIVER_EMAIL);

export const connectSocket = (token) => new Promise((resolve, reject) => {
    const socket = io(API, { transports: ["websocket"], reconnection: false, auth: { token } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
});

// Cambios directos en la base que la API no expone (vencer una solicitud, crear un código conocido, borrar cuentas)
export const dbHelper = (...args) =>
    execSync(`npx tsx "${DB_HELPER}" ${args.join(" ")}`, { cwd: BACKEND_ROOT, stdio: "inherit" });

// Junta los resultados y al final imprime el resumen; sale con 1 si alguna falló
export const createReport = () => {
    const results = [];
    return {
        check: (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail }),
        finish: (extra = "") => {
            const failed = results.filter((r) => !r.ok);
            for (const r of results) console.log(`${r.ok ? "OK  " : "FALLA"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
            console.log(`\n${results.length - failed.length}/${results.length} pruebas pasaron.${extra ? " " + extra : ""}`);
            process.exit(failed.length ? 1 : 0);
        },
    };
};

// JPEG de 1x1: basta para las pruebas, el backend revisa que los primeros bytes sean de una imagen
export const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

// Sube un archivo como lo hace la app: multipart con el campo "file" y los demás campos de texto
export const uploadPhoto = async (path, token, fields = {}, bytes = TINY_JPEG, type = "image/jpeg") => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", new Blob([bytes], { type }), "foto.jpg");
    const res = await fetch(API + path, { method: "POST", headers: token ? { Authorization: token } : {}, body: form });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
};
