-- AlterTable
ALTER TABLE `client_requests` ADD COLUMN `height_cm` DOUBLE NULL,
    ADD COLUMN `length_cm` DOUBLE NULL,
    ADD COLUMN `weight_kg` DOUBLE NULL,
    ADD COLUMN `width_cm` DOUBLE NULL;
