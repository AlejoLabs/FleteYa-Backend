-- Fase 11 (B): reembolso. Un pago aprobado por la app que hay que devolver (el flete se cancela, o llega aprobado un
-- pago de un flete que ya estaba pagado) queda REFUNDED con su fecha. Solo se agregan un valor al enum y dos columnas nulas.
-- Para deshacer: pasar los pagos REFUNDED a VOIDED, quitar el valor del enum y borrar las columnas refunded_at.

ALTER TABLE `payments`
    MODIFY `status` ENUM('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `refunded_at` DATETIME(3) NULL;

-- Cuándo se devolvió el dinero de un flete cancelado (el flete queda sin pagar y sin comisión)
ALTER TABLE `client_requests` ADD COLUMN `refunded_at` DATETIME(3) NULL;
