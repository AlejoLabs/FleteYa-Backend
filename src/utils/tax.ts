import { AppError } from "./App.Error.js";
import { roundMoney } from "./money.js";
import type { TaxProfile } from "../services/countries.service.js";

// Impuesto y propina del flete. Sin ningún "if" por país: todo sale del perfil del país (country_tax_profiles)

// La propina máxima es el valor del flete (100 %): más que eso casi seguro es un error al escribir el monto
export const MAX_TIP_RATE = 1;

// El impuesto se calcula sobre la comisión de FleteYa (que ya viene incluida en el precio acordado): lo asume la
// plataforma y se informa en el comprobante, no se le suma al cliente
export const taxOnCommission = (commission: number, taxRate: number, decimals: number) =>
    roundMoney(commission * taxRate, decimals);

// Propina válida para este país y este flete: redondeada a los decimales de la moneda. Si el país no pide propina
// (modo NONE) solo se acepta 0
export const checkTip = (tip: number, profile: TaxProfile, fare: number, decimals: number) => {
    const amount = roundMoney(tip, decimals);
    if (amount === 0) return 0;
    if (profile.tip_mode === "NONE") {
        throw new AppError("TIP_NOT_ALLOWED", 400);
    }
    if (amount > roundMoney(fare * MAX_TIP_RATE, decimals)) {
        throw new AppError("TIP_TOO_HIGH", 400);
    }
    return amount;
}
