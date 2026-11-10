import { Prisma } from "../generated/prisma/client.js";

// Puntos en MySQL (SRID 4326). MySQL lee el WKT de 4326 con la latitud primero; por eso cada punto se escribe con
// 'axis-order=long-lat' y se lee con ST_Longitude / ST_Latitude. Antes de la Fase 9b se escribían al revés,
// lo que impedía guardar puntos de México o Estados Unidos (longitud menor que −90)

export const AXIS_ORDER = "axis-order=long-lat";

// Para las consultas con plantilla de Prisma ($queryRaw`...`)
export const pointSql = (lng: number, lat: number) =>
    Prisma.sql`ST_GeomFromText(CONCAT('POINT(', ${lng}, ' ', ${lat}, ')'), 4326, 'axis-order=long-lat')`;
