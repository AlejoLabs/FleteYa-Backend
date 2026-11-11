-- Fase 9c: tipo de cambio de referencia. Última tasa buena de cada moneda, para usarla cuando su fuente falla.
-- units_per_usd: cuántas unidades de la moneda vale 1 dólar (la base común; el dólar no se guarda, siempre es 1).
-- source: FRANKFURTER (Banco Central Europeo) o TRM (Banco de la República). rate_date: el día de la tasa publicada.
-- Solo agrega una tabla: para deshacer, borrarla
CREATE TABLE `exchange_rates` (
    `currency_code` CHAR(3) NOT NULL,
    `units_per_usd` DOUBLE NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `rate_date` DATE NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`currency_code`),
    CONSTRAINT `exchange_rates_units_check` CHECK (`units_per_usd` > 0),
    CONSTRAINT `exchange_rates_currency_code_fkey` FOREIGN KEY (`currency_code`) REFERENCES `currencies` (`code`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
