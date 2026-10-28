-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `cancel_reason` VARCHAR(255) NULL,
    ADD COLUMN `canceled_by` INTEGER NULL,
    ADD COLUMN `cargo_category` ENUM('MUDANZA', 'MERCANCIA', 'MATERIALES', 'MAQUINARIA', 'ELECTRODOMESTICOS', 'OTRO') NOT NULL DEFAULT 'OTRO',
    ADD COLUMN `destination_floor` INTEGER NULL,
    ADD COLUMN `destination_has_elevator` BOOLEAN NULL,
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    ADD COLUMN `helpers` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `is_fragile` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `needs_cover` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `packages` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `pickup_floor` INTEGER NULL,
    ADD COLUMN `pickup_has_elevator` BOOLEAN NULL,
    ADD COLUMN `receiver_name` VARCHAR(100) NULL,
    ADD COLUMN `receiver_phone` VARCHAR(20) NULL,
    ADD COLUMN `required_vehicle` ENUM('CARRY', 'ESTACAS', 'FURGON', 'CAMION') NOT NULL DEFAULT 'CARRY',
    ADD COLUMN `scheduled_at` DATETIME(3) NULL,
    ADD COLUMN `sender_name` VARCHAR(100) NULL,
    ADD COLUMN `sender_phone` VARCHAR(20) NULL,
    MODIFY `status` ENUM('CREATED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'TRAVELING', 'FINISHED', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE `driver_car_info` ADD COLUMN `vehicle_type` ENUM('CARRY', 'ESTACAS', 'FURGON', 'CAMION') NOT NULL DEFAULT 'ESTACAS';

-- AlterTable
ALTER TABLE `driver_trip_offers` ADD COLUMN `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE `driver_dismissed_requests` (
    `id_driver` INTEGER NOT NULL,
    `id_client_request` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id_driver`, `id_client_request`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `client_requests_status_expires_at_idx` ON `client_requests`(`status`, `expires_at`);

-- CreateIndex
CREATE INDEX `driver_trip_offers_id_client_request_status_idx` ON `driver_trip_offers`(`id_client_request`, `status`);

-- AddForeignKey
ALTER TABLE `driver_dismissed_requests` ADD CONSTRAINT `driver_dismissed_requests_id_driver_fkey` FOREIGN KEY (`id_driver`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_dismissed_requests` ADD CONSTRAINT `driver_dismissed_requests_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Ofertas antiguas: ya no están pendientes si el viaje dejó de recibir ofertas
UPDATE `driver_trip_offers` O
JOIN `client_requests` CR ON CR.id = O.id_client_request
SET O.status = CASE
    WHEN CR.id_driver_assigned = O.id_driver THEN 'ACCEPTED'
    WHEN CR.id_driver_assigned IS NOT NULL THEN 'REJECTED'
    ELSE 'EXPIRED'
END
WHERE CR.status <> 'CREATED';
