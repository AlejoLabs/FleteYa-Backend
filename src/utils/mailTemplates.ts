import { t } from "../i18n/index.js";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));

// Correo con el código para restablecer la contraseña, escrito en el idioma de la cuenta (users.language)
export const resetCodeMail = (language: string | null | undefined, name: string, code: string, minutes: number) => ({
    subject: t(language, "mail.resetCode.subject"),
    text: t(language, "mail.resetCode.text", { name, code, minutes }),
    html: `<p>${t(language, "mail.resetCode.greeting", { name: escapeHtml(name) })}</p><p>${t(language, "mail.resetCode.intro")}</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>` +
        `<p>${t(language, "mail.resetCode.footer", { minutes })}</p>`,
});
