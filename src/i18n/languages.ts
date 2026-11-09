// Idiomas de FleteYa. El español es la base y el respaldo: lo que falte en otro idioma se dice en español
export const LANGUAGES = ["es", "en", "fr", "it", "pt", "de"] as const;
export type Language = typeof LANGUAGES[number];
export const DEFAULT_LANGUAGE: Language = "es";

export const isLanguage = (value: unknown): value is Language =>
    typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

// De "pt-BR", "EN_us" o un valor raro (o ausente) al idioma que tenemos; español si no hay
export const normalizeLanguage = (value?: unknown): Language => {
    const base = typeof value === "string" ? value.toLowerCase().split(/[-_]/)[0] : undefined;
    return isLanguage(base) ? base : DEFAULT_LANGUAGE;
}

// Etiqueta para dar formato a fechas y números en cada idioma (el español sigue en es-CO, como la app)
export const LOCALE_TAGS: Record<Language, string> = {
    es: "es-CO", en: "en-US", fr: "fr-FR", it: "it-IT", pt: "pt-BR", de: "de-DE",
};
