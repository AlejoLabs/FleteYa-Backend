-- CreateTable
CREATE TABLE `client_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_client` INTEGER NOT NULL,
    `id_driver_assigned` INTEGER NULL,
    `fare_offered` DOUBLE NOT NULL,
    `fare_assigned` DOUBLE NULL,
    `client_rating` DOUBLE NULL,
    `driver_rating` DOUBLE NULL,
    `pickup_description` VARCHAR(255) NOT NULL,
    `destination_description` VARCHAR(255) NOT NULL,
    `cargo_description` VARCHAR(255) NULL,
    `pickup_position` POINT NOT NULL,
    `destination_position` POINT NOT NULL,
    `status` ENUM('CREATED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'TRAVELING', 'FINISHED', 'CANCELED') NOT NULL DEFAULT 'CREATED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_id_client_fkey` FOREIGN KEY (`id_client`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_requests` ADD CONSTRAINT `client_requests_id_driver_assigned_fkey` FOREIGN KEY (`id_driver_assigned`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
