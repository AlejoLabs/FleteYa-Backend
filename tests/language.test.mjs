// Idioma del usuario (Fase 9a): se guarda al registrarse, se cambia desde el perfil y los errores traen su código.
// Crea cuentas @prueba.com y las borra al final. Uso: npm test (con el backend corriendo)
import { call as apiCall, createReport, dbHelper } from "./support/api.mjs";

const { check, finish } = createReport();
const call = (method, path, token, body) => apiCall(method, path, token, body);

const stamp = Date.now();
const emails = ["en", "pt", "none", "raro"].map((tag) => `idioma-${tag}-${stamp}@prueba.com`);
const account = (email, extra = {}) => ({ name: "Ida", lastname: "Prueba", email, phone: "3001112233", password: "123456", ...extra });

try {
    // 1. El idioma del teléfono al registrarse
    const en = await call("POST", "/auth/register", null, account(emails[0], { language: "en" }));
    check("Registro con language=en guarda inglés", en.status === 200 && en.data?.user?.language === "en", `${en.status} ${en.data?.user?.language}`);
    const pt = await call("POST", "/auth/register", null, account(emails[1], { language: "pt-BR" }));
    check("pt-BR se guarda como pt", pt.data?.user?.language === "pt", pt.data?.user?.language);
    const none = await call("POST", "/auth/register", null, account(emails[2]));
    check("Sin idioma queda en español", none.data?.user?.language === "es", none.data?.user?.language);
    const raro = await call("POST", "/auth/register", null, account(emails[3], { language: "klingon" }));
    check("Un idioma que no tenemos queda en español", raro.status === 200 && raro.data?.user?.language === "es", `${raro.status} ${raro.data?.user?.language}`);

    // 2. Cambiarlo desde el perfil
    const token = en.data?.token;
    const id = en.data?.user?.id;
    const changed = await call("PUT", "/users/me/language", token, { language: "fr" });
    check("Cambia a francés", changed.status === 200 && changed.data?.language === "fr", JSON.stringify(changed.data));
    const profile = await call("GET", `/users/${id}`, token);
    check("El perfil devuelve el idioma guardado", profile.data?.language === "fr", profile.data?.language);
    const relogin = await call("POST", "/auth/login", null, { email: emails[0], password: "123456" });
    check("Al volver a entrar el idioma sigue guardado", relogin.data?.user?.language === "fr", relogin.data?.user?.language);
    const invalid = await call("PUT", "/users/me/language", token, { language: "zz" });
    check("Un idioma inválido: 400 con su código", invalid.status === 400 && invalid.data?.keys?.[0]?.key === "LANGUAGE_INVALID", JSON.stringify(invalid.data));
    check("Sin sesión no se puede cambiar: 401", (await call("PUT", "/users/me/language", null, { language: "de" })).status === 401);
    check("Cambiar el idioma no toca el de otra cuenta", (await call("POST", "/auth/login", null, { email: emails[1], password: "123456" })).data?.user?.language === "pt");

    // 3. Los errores traen código para que la app los traduzca; el texto sigue en español
    const wrong = await call("POST", "/auth/login", null, { email: emails[0], password: "mala-clave" });
    check("Error con código y texto en español", wrong.status === 401 && wrong.data?.key === "WRONG_CREDENTIALS" && wrong.data?.message === "Correo o contraseña incorrectos", JSON.stringify(wrong.data));
    const shape = await call("POST", "/auth/login", null, { email: "no-es-correo", password: "1" });
    check("Validación: un código por cada mensaje", shape.status === 400 && shape.data?.keys?.map((k) => k?.key).join() === "EMAIL_FORMAT_INVALID,MIN_6_CHARS", JSON.stringify(shape.data));
    check("Validación: el texto en español sigue en message", Array.isArray(shape.data?.message) && shape.data.message[0] === "Formato del correo no valido");
    const soatVencido = await call("POST", "/auth/register-driver", null, {
        ...account(`idioma-vencido-${stamp}@prueba.com`),
        vehicle: { vehicle_type: "CARRY", brand: "Kia", color: "Rojo", plate: "ABC123", model_year: 2019, is_covered: false, license_number: "1012345678", license_category: "C1",
            license_expires_at: new Date(Date.now() + 365 * 86400000).toISOString(), soat_expires_at: "2024-01-01", property_card_number: "10002345678" },
    });
    const documentError = soatVencido.data?.keys?.find((k) => k?.key === "DOC_EXPIRED");
    check("Mensaje con datos: el nombre del campo viaja como clave", soatVencido.status === 400 && documentError?.params?.document === "@fields.soat", JSON.stringify(soatVencido.data));
    check("El texto en español se arma con ese dato", soatVencido.data?.message === "El SOAT está vencido" || soatVencido.data?.message?.includes?.("El SOAT está vencido"), JSON.stringify(soatVencido.data?.message));
    const forgot = await call("POST", "/auth/forgot-password", null, { email: emails[2] });
    check("Los mensajes de éxito también traen código", forgot.status === 200 && forgot.data?.key === "FORGOT_PASSWORD_SENT", JSON.stringify(forgot.data));
} finally {
    dbHelper("delete", ...emails);
}
finish();
