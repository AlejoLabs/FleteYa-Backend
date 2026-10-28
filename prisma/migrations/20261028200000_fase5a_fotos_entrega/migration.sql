-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `delivery_code` CHAR(4) NULL,
    ADD COLUMN `delivery_code_attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reminder_sent_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `driver_car_info` ADD COLUMN `documents_reminded_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `notification_token` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `trip_photos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_client_request` INTEGER NOT NULL,
    `id_user` INTEGER NOT NULL,
    `kind` ENUM('CARGO', 'PICKUP', 'DELIVERY') NOT NULL,
    `file_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trip_photos_id_client_request_kind_idx`(`id_client_request`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_photos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_driver` INTEGER NOT NULL,
    `file_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicle_photos_id_driver_idx`(`id_driver`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trip_photos` ADD CONSTRAINT `trip_photos_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_photos` ADD CONSTRAINT `trip_photos_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_photos` ADD CONSTRAINT `vehicle_photos_id_driver_fkey` FOREIGN KEY (`id_driver`) REFERENCES `driver_car_info`(`id_driver`) ON DELETE CASCADE ON UPDATE CASCADE;

