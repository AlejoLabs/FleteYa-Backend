/*
  Warnings:

  - Added the required column `size_rate` to the `time_and_distance_values` table without a default value. This is not possible if the table is not empty.
  - Added the required column `weight_rate` to the `time_and_distance_values` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `time_and_distance_values` ADD COLUMN `size_rate` DOUBLE NOT NULL,
    ADD COLUMN `weight_rate` DOUBLE NOT NULL;
