-- CreateTable
CREATE TABLE `time_and_distance_values` (
    `id` INTEGER NOT NULL,
    `km_value` DOUBLE NOT NULL,
    `min_value` DOUBLE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
