-- Fase 9b: las posiciones se guardaban con los ejes al revés.
-- ST_GeomFromText('POINT(lng lat)', 4326) lee la latitud primero. En Colombia no fallaba (−74 cabe como latitud),
-- pero en México o Estados Unidos (−99, −118) MySQL rechazaba el punto, y las distancias salían mal
-- (Bogotá–Medellín daba 172 km en vez de 246). Desde ahora el backend escribe con 'axis-order=long-lat' y lee con
-- ST_Longitude / ST_Latitude; aquí se voltean las que ya existen.
-- update_at se asigna a sí mismo para no cambiarlo. Para deshacer: repetir los mismos UPDATE (ST_SwapXY se deshace solo)
UPDATE `client_requests` SET
    `pickup_position` = ST_SwapXY(`pickup_position`),
    `destination_position` = ST_SwapXY(`destination_position`),
    `update_at` = `update_at`;
UPDATE `drivers_position` SET `position` = ST_SwapXY(`position`);
