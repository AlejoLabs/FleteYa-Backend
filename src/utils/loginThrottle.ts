import { AppError } from "./App.Error.js";

// Freno a quien prueba contraseñas: tras 5 fallos seguidos con el mismo correo, ese correo espera 15 minutos.
// Cuenta también los correos que no existen, para no revelar cuáles están registrados.
// Vive en memoria: alcanza para un solo servidor (si se reinicia, los contadores vuelven a cero)
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; lockedUntil: number }>();

const keyFor = (email: string) => email.trim().toLowerCase();

export const assertLoginAllowed = (email: string) => {
    const entry = failures.get(keyFor(email));
    if (entry && entry.lockedUntil > Date.now()) {
        const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
        console.warn(`[auth] login bloqueado correo=${keyFor(email)} minutos=${minutes}`);
        throw new AppError("TOO_MANY_LOGIN_ATTEMPTS", 429, undefined, { count: minutes });
    }
};

export const registerLoginFailure = (email: string) => {
    const key = keyFor(email);
    const entry = failures.get(key);
    // Pasado el bloqueo se empieza de cero
    const count = entry && entry.lockedUntil <= Date.now() && entry.count >= MAX_FAILURES ? 1 : (entry?.count ?? 0) + 1;
    failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
};

export const clearLoginFailures = (email: string) => {
    failures.delete(keyFor(email));
};
