import nodemailer, { type Transporter } from "nodemailer";

// Correo saliente por SMTP (para la demo, Gmail con una contraseña de aplicación). Se configura en el .env:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y MAIL_FROM
const isConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter: Transporter | null = null;
const getTransporter = () => {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT ?? 465);
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    }
    return transporter;
}

export const sendMail = async (to: string, subject: string, text: string, html: string) => {
    if (!isConfigured()) {
        // Sin SMTP el correo no sale: en desarrollo se muestra en la consola para poder probar el flujo
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP no configurado");
        }
        console.log(`[correo] SMTP sin configurar. Para ${to}: ${subject}\n${text}`);
        return;
    }
    await getTransporter().sendMail({
        from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
        to,
        subject,
        text,
        html,
    });
}
