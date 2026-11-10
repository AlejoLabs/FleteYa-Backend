// Montos en la moneda de cada flete. Se guardan como Float (DOUBLE) redondeados a los decimales de su moneda:
// COP sin centavos, EUR o USD con dos. Un DOUBLE guarda exacto cualquier monto de hasta 15 cifras, así que con
// redondear en cada escritura basta y la API sigue mandando números (con DECIMAL llegarían como texto a la app)

export const roundMoney = (value: number, decimals: number) => {
    const factor = 10 ** decimals;
    // EPSILON corrige casos como 1.005 * 100 = 100.49999...
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

// "$ 25.000" (es-CO, COP), "25 €" (fr-FR, EUR), "US$ 27,50" (es-CO, USD). Los montos enteros van sin ",00"
export const formatMoney = (value: number, currency: string, locale: string) => {
    const whole = Number.isInteger(roundMoney(value, 2));
    try {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
            ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
        }).format(value);
    } catch {
        return `${value} ${currency}`;
    }
}
