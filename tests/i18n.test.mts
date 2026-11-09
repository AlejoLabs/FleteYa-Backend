// Textos traducidos del backend (Fase 9a): idiomas completos, plurales, respaldo en español, notificaciones y correos.
// Se ejecuta con tsx porque importa el código de src/. Uso: npm test
import { createReport } from "./support/api.mjs";
import { LANGUAGES, hasKey, normalizeLanguage, t } from "../src/i18n/index.js";
import { pushText } from "../src/utils/push.js";
import { resetCodeMail } from "../src/utils/mailTemplates.js";
import { parseValidationMessage, validationText, vm } from "../src/i18n/validation.js";
import prisma from "../src/database/prismaClient.js";
import es from "../src/i18n/locales/es.json" with { type: "json" };
import en from "../src/i18n/locales/en.json" with { type: "json" };
import fr from "../src/i18n/locales/fr.json" with { type: "json" };
import it from "../src/i18n/locales/it.json" with { type: "json" };
import pt from "../src/i18n/locales/pt.json" with { type: "json" };
import de from "../src/i18n/locales/de.json" with { type: "json" };

const { check, finish } = createReport();

// ---- Cada idioma tiene todas las claves del español y los mismos {{datos}}
type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
    Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string") acc[`${prefix}${key}`] = value;
        else Object.assign(acc, flatten(value, `${prefix}${key}.`));
        return acc;
    }, {});
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const placeholders = (texts: string[]) => [...new Set(texts.flatMap((text) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!)))].sort().join(",");
const groups = (flat: Record<string, string>) => {
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(flat)) (out[base(key)] ??= []).push(value);
    return out;
};
const esGroups = groups(flatten(es as Tree));
for (const [code, locale] of Object.entries({ en, fr, it, pt, de })) {
    const other = groups(flatten(locale as Tree));
    const missing = Object.keys(esGroups).filter((key) => !(key in other));
    const extra = Object.keys(other).filter((key) => !(key in esGroups));
    const wrongData = Object.keys(esGroups).filter((key) => key in other && placeholders(esGroups[key]!) !== placeholders(other[key]!));
    const empty = Object.entries(other).filter(([, texts]) => texts.some((text) => !text.trim())).map(([key]) => key);
    check(`${code}.json tiene todas las claves del español`, missing.length === 0 && extra.length === 0, `faltan: ${missing.slice(0, 3)} sobran: ${extra.slice(0, 3)}`);
    check(`${code}.json usa los mismos {{datos}} y no tiene textos vacíos`, wrongData.length === 0 && empty.length === 0, `${wrongData.slice(0, 3)} ${empty.slice(0, 3)}`);
}

// ---- t(): idiomas, plurales y respaldo
check("Español: texto de un error", t("es", "errors.WRONG_CREDENTIALS") === "Correo o contraseña incorrectos");
check("Inglés: el mismo error", t("en", "errors.WRONG_CREDENTIALS") !== t("es", "errors.WRONG_CREDENTIALS") && /password/i.test(t("en", "errors.WRONG_CREDENTIALS")));
check("Un idioma desconocido cae a español", t("xx", "errors.WRONG_CREDENTIALS") === t("es", "errors.WRONG_CREDENTIALS"));
check("normalizeLanguage: pt-BR → pt, valor raro → es", normalizeLanguage("pt-BR") === "pt" && normalizeLanguage("DE_de") === "de" && normalizeLanguage("zz") === "es" && normalizeLanguage(undefined) === "es");
check("Sin la clave devuelve la clave", t("es", "errors.NO_EXISTE") === "errors.NO_EXISTE" && !hasKey("errors.NO_EXISTE"));
check("Datos {{x}} en el texto", t("es", "errors.INVALID_STATUS_CHANGE", { from: "CREATED", to: "FINISHED" }) === "No se puede pasar de CREATED a FINISHED");
const one = t("es", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 1 });
const many = t("es", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 4 });
check("Plural en español: 1 minuto / 4 minutos", /1 minuto /.test(one) && /4 minutos /.test(many), `${one} | ${many}`);
check("Plural en inglés", /1 minute /.test(t("en", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 1 })) && /4 minutes /.test(t("en", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 4 })));
check("Plural en francés (0 y 1 van en singular)", /0 minute /.test(t("fr", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 0 })) && /2 minutes /.test(t("fr", "errors.TOO_MANY_LOGIN_ATTEMPTS", { count: 2 })));

// ---- Mensajes de validación con datos
const fare = vm("FARE_MIN", { field: "@fields.fare_offered", min: "$5.000" });
const parsed = parseValidationMessage(fare);
check("Validación: se lee el código y los datos", parsed?.key === "FARE_MIN" && parsed.params?.min === "$5.000");
check("Validación en español arma la frase con el nombre del campo", parsed !== null && validationText("es", parsed) === "La tarifa ofrecida debe ser de al menos $5.000", parsed ? validationText("es", parsed) : "");
check("Validación en inglés usa el campo en inglés", parsed !== null && /offered fare/i.test(validationText("en", parsed)), parsed ? validationText("en", parsed) : "");
check("Un mensaje cualquiera de zod no se toma por código", parseValidationMessage("Invalid input") === null && parseValidationMessage("Texto en español") === null);

// ---- Notificaciones y correos en el idioma guardado del usuario
const message = { key: "DRIVER_ASSIGNED", params: { amount: "$50.000" } };
for (const code of LANGUAGES) {
    const { title, body } = pushText(code, message);
    check(`Notificación en ${code}: título y texto con el valor`, Boolean(title) && body.includes("$50.000") && !title.startsWith("push."), `${title} | ${body}`);
}
check("Las notificaciones de cada idioma son distintas", new Set(LANGUAGES.map((code) => pushText(code, message).title)).size === LANGUAGES.length);
check("Notificación con plural (1 y 5 minutos)", /1 minuto/.test(pushText("es", { key: "NEW_OFFER", params: { amount: "$1", count: 1 } }).body) && /5 minutos/.test(pushText("es", { key: "NEW_OFFER", params: { amount: "$1", count: 5 } }).body));
for (const code of LANGUAGES) {
    const mail = resetCodeMail(code, "Ana <b>", "123456", 15);
    check(`Correo del código en ${code}`, mail.text.includes("123456") && mail.text.includes("15") && mail.html.includes("123456") && !mail.html.includes("<b>"), mail.subject);
}
check("El asunto del correo cambia con el idioma", resetCodeMail("en", "Ana", "1", 15).subject !== resetCodeMail("es", "Ana", "1", 15).subject);

// ---- El idioma que usa el aviso es el guardado en el usuario
const email = `idioma-push-${Date.now()}@prueba.com`;
const user = await prisma.user.create({ data: { name: "Push", lastname: "Prueba", email, phone: "", password: null, language: "de" } });
try {
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { language: true } });
    check("El usuario guardado tiene idioma alemán", saved.language === "de");
    check("El aviso para ese usuario sale en alemán", pushText(saved.language, { key: "DRIVER_ARRIVED" }).title === t("de", "push.DRIVER_ARRIVED.title"));
    check("Una cuenta sin idioma elegido recibe español", (await prisma.user.create({ data: { name: "Sin", lastname: "Idioma", email: `sin-${email}`, phone: "", password: null } }).then(async (created) => {
        const language = created.language;
        await prisma.user.delete({ where: { id: created.id } });
        return language;
    })) === "es");
} finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
}
finish();
