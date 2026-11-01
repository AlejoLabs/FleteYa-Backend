-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `commission` DOUBLE NULL,
    ADD COLUMN `commission_rate` DOUBLE NULL,
    ADD COLUMN `declared_value` DOUBLE NULL,
    ADD COLUMN `paid_at` DATETIME(3) NULL,
    ADD COLUMN `payment_method` ENUM('CASH', 'WOMPI') NOT NULL DEFAULT 'CASH';

-- AlterTable
ALTER TABLE `time_and_distance_values` ADD COLUMN `commission_rate` DOUBLE NOT NULL DEFAULT 0.1;

-- CreateTable
CREATE TABLE `vehicle_rates` (
    `vehicle_type` ENUM('CARRY', 'ESTACAS', 'FURGON', 'CAMION') NOT NULL,
    `base_fare` DOUBLE NOT NULL,
    `km_factor` DOUBLE NOT NULL,

    PRIMARY KEY (`vehicle_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_client_request` INTEGER NOT NULL,
    `reference` VARCHAR(64) NOT NULL,
    `method` ENUM('CASH', 'WOMPI') NOT NULL,
    `amount` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `wompi_transaction_id` VARCHAR(64) NULL,
    `wompi_method` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_reference_key`(`reference`),
    INDEX `payments_id_client_request_created_at_idx`(`id_client_request`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tarifas iniciales por vehículo: base en pesos y factor sobre distancia y tiempo
INSERT INTO `vehicle_rates` (`vehicle_type`, `base_fare`, `km_factor`) VALUES
    ('CARRY', 15000, 1),
    ('ESTACAS', 25000, 1.3),
    ('FURGON', 40000, 1.6),
    ('CAMION', 70000, 2.2);

-- Los viajes terminados antes de la Fase 7 se pagaron por fuera de la app: quedan como pagados en efectivo y sin comisión
UPDATE `client_requests` SET `paid_at` = `update_at`, `commission_rate` = 0, `commission` = 0 WHERE `status` = 'FINISHED';
