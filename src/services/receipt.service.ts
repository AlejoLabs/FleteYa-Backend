import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import { roundMoney } from "../utils/money.js";
import { taxOnCommission } from "../utils/tax.js";
import { getCountry } from "./countries.service.js";

// Comprobante de un flete pagado. Las cifras salen de lo que se fijó al pagar (propina, impuesto, comisión), no de las
// tasas de hoy: si el país cambia su impuesto, los comprobantes ya emitidos no cambian.
// Los montos viajan como números; la app los formatea con la moneda y la fecha (UTC) con la zona del teléfono

const fullName = (user: { name: string; lastname: string } | null) => user ? `${user.name} ${user.lastname}`.trim() : null;

// Número legible y estable: FY-CO-2026-000123 (país, año UTC del pago, id del flete)
export const receiptNumber = (country: string, paidAt: Date, id: number) =>
    `FY-${country}-${paidAt.getUTCFullYear()}-${String(id).padStart(6, "0")}`;

export const getReceipt = async (userId: number, id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: {
            id: true, id_client: true, id_driver_assigned: true, country_code: true, currency: true, status: true,
            fare_assigned: true, commission: true, commission_rate: true, paid_at: true, payment_method: true, tip: true,
            tax_name: true, tax_rate: true, tax_amount: true, receipt_type: true,
            pickup_description: true, destination_description: true,
            client: { select: { name: true, lastname: true } },
            driver: { select: { name: true, lastname: true } },
        }
    });
    if (!trip) {
        throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    if (trip.id_client !== userId && trip.id_driver_assigned !== userId) {
        throw deny(userId, "ver-comprobante", `client_requests/${id}`);
    }
    if (!trip.paid_at) {
        throw new AppError("RECEIPT_NOT_AVAILABLE", 409);
    }

    const country = await getCountry(trip.country_code);
    const decimals = country.currency.decimals;
    const fare = roundMoney(trip.fare_assigned ?? 0, decimals);
    const commission = roundMoney(trip.commission ?? 0, decimals);
    // Fletes pagados antes de la Fase 11 no guardaron el impuesto: se calcula con el perfil actual del país
    const taxRate = trip.tax_rate ?? country.tax.tax_rate;
    const taxAmount = trip.tax_amount ?? taxOnCommission(commission, taxRate, decimals);
    const total = roundMoney(fare + trip.tip, decimals);

    return {
        receipt_number: receiptNumber(trip.country_code, trip.paid_at, trip.id),
        receipt_type: trip.receipt_type ?? country.tax.receipt_type,
        tax_id_label: country.tax.tax_id_label,
        id_client_request: trip.id,
        country_code: trip.country_code,
        currency: trip.currency,
        issued_at: trip.paid_at.toISOString(),
        payment_method: trip.payment_method,
        pickup_description: trip.pickup_description,
        destination_description: trip.destination_description,
        client: fullName(trip.client),
        driver: fullName(trip.driver),
        // included: true = ya está dentro del valor del flete (no se suma al total, se informa)
        lines: [
            { type: "TRANSPORT", amount: fare, included: false },
            { type: "TIP", amount: trip.tip, included: false },
            { type: "COMMISSION", amount: commission, rate: trip.commission_rate, included: true },
            { type: "TAX", amount: taxAmount, rate: taxRate, name: trip.tax_name ?? country.tax.tax_name, included: true },
        ],
        total,
    };
}
