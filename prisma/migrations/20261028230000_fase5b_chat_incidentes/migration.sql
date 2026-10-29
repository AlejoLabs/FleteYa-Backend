-- CreateTable
CREATE TABLE `trip_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_client_request` INTEGER NOT NULL,
    `id_sender` INTEGER NOT NULL,
    `text` VARCHAR(500) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trip_messages_id_client_request_id_idx`(`id_client_request`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incident_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_client_request` INTEGER NOT NULL,
    `id_reporter` INTEGER NOT NULL,
    `kind` ENUM('DAMAGE', 'LOSS', 'DELAY', 'BEHAVIOR', 'OTHER') NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `status` ENUM('OPEN', 'IN_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_at` DATETIME(3) NOT NULL,

    INDEX `incident_reports_id_client_request_id_reporter_idx`(`id_client_request`, `id_reporter`),
    INDEX `incident_reports_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incident_photos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_incident` INTEGER NOT NULL,
    `file_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `incident_photos_id_incident_idx`(`id_incident`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `trip_messages` ADD CONSTRAINT `trip_messages_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_messages` ADD CONSTRAINT `trip_messages_id_sender_fkey` FOREIGN KEY (`id_sender`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_reports` ADD CONSTRAINT `incident_reports_id_client_request_fkey` FOREIGN KEY (`id_client_request`) REFERENCES `client_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_reports` ADD CONSTRAINT `incident_reports_id_reporter_fkey` FOREIGN KEY (`id_reporter`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_photos` ADD CONSTRAINT `incident_photos_id_incident_fkey` FOREIGN KEY (`id_incident`) REFERENCES `incident_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

