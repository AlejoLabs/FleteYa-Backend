-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `commission_settled_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `driver_car_info` ADD COLUMN `approval_note` VARCHAR(255) NULL,
    ADD COLUMN `reviewed_at` DATETIME(3) NULL,
    MODIFY `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `anonymized_at` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `status_reason` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `admin_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_admin` INTEGER NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `target_type` VARCHAR(30) NOT NULL,
    `target_id` INTEGER NULL,
    `detail` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_actions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_actions` ADD CONSTRAINT `admin_actions_id_admin_fkey` FOREIGN KEY (`id_admin`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- La liquidación de comisiones en efectivo empieza con la Fase 8: lo cobrado antes se da por liquidado
UPDATE `client_requests` SET `commission_settled_at` = `paid_at` WHERE `payment_method` = 'CASH' AND `paid_at` IS NOT NULL;
