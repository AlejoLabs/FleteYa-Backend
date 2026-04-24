-- CreateTable
CREATE TABLE `drivers_position` (
    `id_driver` INTEGER NOT NULL,
    `position` POINT NOT NULL,

    PRIMARY KEY (`id_driver`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `drivers_position` ADD CONSTRAINT `drivers_position_id_driver_fkey` FOREIGN KEY (`id_driver`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
