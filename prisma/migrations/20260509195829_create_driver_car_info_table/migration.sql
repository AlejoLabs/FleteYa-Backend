-- CreateTable
CREATE TABLE `driver_car_info` (
    `id_driver` INTEGER NOT NULL,
    `brand` VARCHAR(50) NOT NULL,
    `color` VARCHAR(50) NOT NULL,
    `plate` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id_driver`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `driver_car_info` ADD CONSTRAINT `driver_car_info_id_driver_fkey` FOREIGN KEY (`id_driver`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
