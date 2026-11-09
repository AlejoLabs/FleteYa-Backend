-- Fase 9a: idioma de cada usuario. Solo agrega la columna; las cuentas existentes quedan en español
ALTER TABLE `users` ADD COLUMN `language` VARCHAR(5) NOT NULL DEFAULT 'es';
