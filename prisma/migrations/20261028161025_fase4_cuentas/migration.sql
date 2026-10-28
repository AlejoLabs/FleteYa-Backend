-- AlterTable
ALTER TABLE `driver_car_info` ADD COLUMN `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
    ADD COLUMN `is_covered` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `license_category` VARCHAR(3) NULL,
    ADD COLUMN `license_expires_at` DATETIME(3) NULL,
    ADD COLUMN `license_number` VARCHAR(30) NULL,
    ADD COLUMN `model_year` INTEGER NULL,
    ADD COLUMN `property_card_number` VARCHAR(30) NULL,
    ADD COLUMN `soat_expires_at` DATETIME(3) NULL,
    ADD COLUMN `techno_expires_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `email_verified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `google_id` VARCHAR(64) NULL,
    MODIFY `password` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `password_reset_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_user` INTEGER NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `password_reset_codes_id_user_created_at_idx`(`id_user`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `users_google_id_key` ON `users`(`google_id`);

-- AddForeignKey
ALTER TABLE `password_reset_codes` ADD CONSTRAINT `password_reset_codes_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

