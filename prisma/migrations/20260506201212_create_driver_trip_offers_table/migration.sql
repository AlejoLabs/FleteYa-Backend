-- CreateTable
CREATE TABLE `driver_trip_offers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_driver` INTEGER NOT NULL,
    `id_client_request` INTEGER NOT NULL,
    `fare_offered` DOUBLE NOT NULL,
    `time` DOUBLE NOT NULL,
    `distance` DOUBLE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `driver_trip_offers` ADD CONSTRAINT `driver_trip_offers_id_driver_fkey` FOREIGN KEY (`id_driver`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_trip_offers` ADD CONSTRAINT `driver_trip_offers_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
