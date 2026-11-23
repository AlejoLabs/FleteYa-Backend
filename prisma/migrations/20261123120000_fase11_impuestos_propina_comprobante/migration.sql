-- Fase 11: impuesto, propina y comprobante por país, como DATOS (sin código por país).
-- Se agregan una tabla y columnas nuevas sin borrar nada: los viajes ya pagados quedan con propina 0 y sin datos de
-- impuesto (tax_* en null), y su comprobante se arma con el perfil actual del país.
-- Para deshacer: borrar las columnas tip, tax_name, tax_rate, tax_amount y receipt_type de client_requests, tip de payments
-- y la tabla country_tax_profiles.

CREATE TABLE `country_tax_profiles` (
    `country_code` CHAR(2) NOT NULL,
    `tax_name` VARCHAR(30) NOT NULL,
    `tax_rate` DOUBLE NOT NULL,
    `receipt_type` VARCHAR(40) NOT NULL,
    `tax_id_label` VARCHAR(40) NOT NULL,
    `tip_mode` ENUM('NONE', 'OPTIONAL', 'SUGGESTED') NOT NULL DEFAULT 'OPTIONAL',
    `tip_suggestions` JSON NULL,
    PRIMARY KEY (`country_code`),
    CONSTRAINT `country_tax_profiles_rate_check` CHECK (`tax_rate` >= 0 AND `tax_rate` <= 0.5),
    CONSTRAINT `country_tax_profiles_country_code_fkey` FOREIGN KEY (`country_code`) REFERENCES `countries` (`code`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Los 5 países piloto (coinciden con el informe) y los demás con el impuesto general de referencia.
-- El impuesto se cobra sobre la comisión de FleteYa; tax_rate es una fracción (0.19 = 19 %)
INSERT INTO `country_tax_profiles` (`country_code`, `tax_name`, `tax_rate`, `receipt_type`, `tax_id_label`, `tip_mode`, `tip_suggestions`) VALUES
    ('CO', 'IVA', 0.19, 'FACTURA_ELECTRONICA', 'NIT', 'OPTIONAL', NULL),
    ('BR', 'ISS', 0.05, 'NFSE', 'CNPJ', 'OPTIONAL', NULL),
    ('US', 'Sales tax', 0.08875, 'RECEIPT', 'EIN', 'SUGGESTED', JSON_ARRAY(15, 18, 20)),
    ('FR', 'TVA', 0.20, 'FACTURE', 'SIRET', 'NONE', NULL),
    ('DE', 'MwSt.', 0.19, 'RECHNUNG', 'USt-IdNr.', 'OPTIONAL', NULL),
    ('MX', 'IVA', 0.16, 'GENERIC', 'RFC', 'OPTIONAL', NULL),
    ('EC', 'IVA', 0.15, 'GENERIC', 'RUC', 'OPTIONAL', NULL),
    ('PA', 'ITBMS', 0.07, 'GENERIC', 'RUC', 'OPTIONAL', NULL),
    ('SV', 'IVA', 0.13, 'GENERIC', 'NIT', 'OPTIONAL', NULL),
    ('PR', 'IVU', 0.115, 'GENERIC', 'EIN', 'OPTIONAL', NULL),
    ('ES', 'IVA', 0.21, 'GENERIC', 'NIF', 'OPTIONAL', NULL),
    ('IT', 'IVA', 0.22, 'GENERIC', 'Partita IVA', 'OPTIONAL', NULL),
    ('PT', 'IVA', 0.23, 'GENERIC', 'NIF', 'OPTIONAL', NULL),
    ('AT', 'USt', 0.20, 'GENERIC', 'UID', 'OPTIONAL', NULL),
    ('BE', 'TVA', 0.21, 'GENERIC', 'N° TVA', 'OPTIONAL', NULL),
    ('LU', 'TVA', 0.17, 'GENERIC', 'N° TVA', 'OPTIONAL', NULL),
    ('IE', 'VAT', 0.23, 'GENERIC', 'VAT number', 'OPTIONAL', NULL),
    ('MT', 'VAT', 0.18, 'GENERIC', 'VAT number', 'OPTIONAL', NULL),
    ('MC', 'TVA', 0.20, 'GENERIC', 'N° TVA', 'NONE', NULL),
    ('AD', 'IGI', 0.045, 'GENERIC', 'NRT', 'OPTIONAL', NULL),
    ('SM', 'IVA', 0, 'GENERIC', 'COE', 'OPTIONAL', NULL),
    ('AU', 'GST', 0.10, 'GENERIC', 'ABN', 'NONE', NULL),
    ('IN', 'GST', 0.18, 'GENERIC', 'GSTIN', 'OPTIONAL', NULL),
    ('ZA', 'VAT', 0.15, 'GENERIC', 'VAT number', 'OPTIONAL', NULL);

-- Lo que se fija en el flete al pagarlo (para que el comprobante no cambie si luego cambian las tasas)
ALTER TABLE `client_requests`
    ADD COLUMN `tip` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `tax_name` VARCHAR(30) NULL,
    ADD COLUMN `tax_rate` DOUBLE NULL,
    ADD COLUMN `tax_amount` DOUBLE NULL,
    ADD COLUMN `receipt_type` VARCHAR(40) NULL;

-- La propina viaja con el intento de pago: el monto cobrado es valor acordado + propina
ALTER TABLE `payments` ADD COLUMN `tip` DOUBLE NOT NULL DEFAULT 0;
