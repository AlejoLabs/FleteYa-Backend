import express from "express";
import type { Request, Response } from "express";
import { getSimulatedPayment, startSimulatedPayment } from "../utils/paymentGateway.js";
import { evaluateSimulatorForm } from "../utils/simulatorTestData.js";
import { checkoutPage, messagePage, processingPage, resultPage, wompiReturnPage } from "./payment_simulator.page.js";

// Pasarela de prueba: hace las veces del checkout de Wompi mientras no haya llaves. Pide tarjeta, Nequi o PSE,
// solo acepta los datos de prueba, muestra "procesando" y un comprobante.
// Responde solo con PAYMENTS_SIMULATOR=true y sin llaves de Wompi; la referencia es aleatoria y vale para un solo intento

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const notFound = () => messagePage("Pago no encontrado", "Vuelve a FleteYa y toca \"Pagar\" otra vez.");

router.get("/:reference", (req: Request, res: Response) => {
    const reference = String(req.params.reference);
    const payment = getSimulatedPayment(reference);
    if (!payment) {
        return res.status(404).send(notFound());
    }
    if (payment.transaction) {
        return res.send(resultPage({
            approved: payment.transaction.status === "APPROVED",
            reference,
            transactionId: payment.transaction.id,
            description: payment.description ?? "",
            amountCents: payment.amount_in_cents,
        }));
    }
    if (payment.processing) {
        return res.send(processingPage(payment.processing.method as "CARD" | "NEQUI" | "PSE"));
    }
    return res.send(checkoutPage({ reference, amountCents: payment.amount_in_cents }));
});

router.post("/:reference", (req: Request, res: Response) => {
    const reference = String(req.params.reference);
    const payment = getSimulatedPayment(reference);
    if (!payment) {
        return res.status(404).send(notFound());
    }
    if (payment.processing) {
        return res.status(409).send(messagePage("Este pago ya se procesó", "Vuelve a FleteYa."));
    }
    // El número de la tarjeta o del celular solo se usa para validar aquí: no se guarda ni se registra
    const result = evaluateSimulatorForm(req.body);
    if (!result.ok) {
        return res.status(400).send(checkoutPage({ reference, amountCents: payment.amount_in_cents, active: result.method, error: result.error }));
    }
    startSimulatedPayment(reference, result.status, result.method, result.description);
    // Patrón post-redirect-get: recargar la página no reenvía el formulario
    return res.redirect(303, req.originalUrl);
});

// Al terminar el checkout de Wompi: devuelve a la app, que pregunta el resultado al backend
export const paymentReturnRouter = express.Router();
paymentReturnRouter.get("/:reference", (req: Request, res: Response) => {
    res.send(wompiReturnPage(String(req.params.reference)));
});

export default router;
