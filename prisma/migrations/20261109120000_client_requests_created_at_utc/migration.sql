-- client_requests.created_at se guardaba con NOW() (hora local del servidor MySQL) y el resto de fechas en UTC.
-- Se pasan las filas existentes a UTC sumando la diferencia entre la hora UTC y la hora local del servidor.
UPDATE `client_requests`
SET `created_at` = `created_at` + INTERVAL TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()) SECOND;
