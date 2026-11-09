import { DEFAULT_LANGUAGE, LANGUAGES, normalizeLanguage, type Language } from "./languages.js";
import es from "./locales/es.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };

export { LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, isLanguage, LOCALE_TAGS, type Language } from "./languages.js";

// Textos que el backend le dice a la gente: errores (errors.*), notificaciones (push.*) y correos (mail.*).
// Cada idioma es un árbol de textos; se aplana a "errors.TRIP_NOT_FOUND" para buscar rápido
type Tree = { [key: string]: string | Tree };
export type Params = Record<string, string | number | null | undefined>;

const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
    Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string") acc[`${prefix}${key}`] = value;
        else Object.assign(acc, flatten(value, `${prefix}${key}.`));
        return acc;
    }, {});

const catalogs: Record<Language, Record<string, string>> = {
    es: flatten(es), en: flatten(en), fr: flatten(fr), it: flatten(it), pt: flatten(pt), de: flatten(de),
};

const pluralRules: Record<Language, Intl.PluralRules> = Object.fromEntries(
    LANGUAGES.map((language) => [language, new Intl.PluralRules(language)]),
) as Record<Language, Intl.PluralRules>;

// Busca el texto: con params.count elige la forma del plural (clave_one, clave_other...) según el idioma
const lookup = (language: Language, key: string, count?: number): string | undefined => {
    const catalog = catalogs[language];
    if (count !== undefined) {
        const plural = catalog[`${key}_${pluralRules[language].select(count)}`] ?? catalog[`${key}_other`];
        if (plural !== undefined) return plural;
    }
    return catalog[key];
}

// t("en", "errors.TRIP_NOT_FOUND") → texto en inglés; si falta, el español; si tampoco, la clave
export const t = (language: Language | string | null | undefined, key: string, params: Params = {}): string => {
    const lang = normalizeLanguage(language);
    const count = typeof params.count === "number" ? params.count : undefined;
    const template = lookup(lang, key, count) ?? lookup(DEFAULT_LANGUAGE, key, count) ?? key;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ""));
}

// Respuesta de éxito con mensaje: message en español y key para que la app lo traduzca (messages.*)
export const okMessage = (key: string, params?: Params) => ({ message: t("es", `messages.${key}`, params), key });

export const hasKey = (key: string) => key in catalogs[DEFAULT_LANGUAGE] || `${key}_other` in catalogs[DEFAULT_LANGUAGE];
