import axios from "axios";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { canCarry, vehicleRank } from "../utils/vehicles.js";
import { ACTIVE_STATUSES } from "./client_request.shared.js";
import { MAX_DELIVERY_ATTEMPTS } from "./client_request_trip.service.js";
import { clientRatings, driverRatings, ratingOf } from "./ratings.service.js";
import { assertDriverCanWork } from "./driver_eligibility.service.js";

// Consultas de solicitudes: las cercanas para el conductor, el detalle de una y los historiales

// Búsquedas y viajes en curso del usuario, como cliente o como conductor: alimenta "Próximos fletes"
// y permite volver a la pantalla correcta si la app se cerró a mitad de un viaje
export const getMyActiveTrips = async (userId: number) => {
    const trips = await prisma.clientRequests.findMany({
        where: {
            OR: [
                { id_client: userId, status: { in: ["CREATED", ...ACTIVE_STATUSES] } },
                { id_driver_assigned: userId, status: { in: ACTIVE_STATUSES } },
                // Entregado pero sin pagar: sigue pendiente para los dos hasta que se pague
                { OR: [{ id_client: userId }, { id_driver_assigned: userId }], status: "FINISHED", paid_at: null }
            ]
        },
        select: {
            id: true, id_client: true, id_driver_assigned: true, status: true,
            fare_offered: true, fare_assigned: true, payment_method: true, paid_at: true,
            pickup_description: true, destination_description: true,
            cargo_category: true, cargo_description: true, required_vehicle: true,
            scheduled_at: true, expires_at: true, created_at: true
        },
        orderBy: [{ scheduled_at: "asc" }, { created_at: "desc" }],
        take: 50
    });
    return trips.map((trip) => ({ ...trip, role: trip.id_client === userId ? "CLIENT" : "DRIVER" }));
}

const toBool = (value: any) => value === null || value === undefined ? null : Boolean(Number(value));

// Campos de carga, cargue y programación que ven el conductor y el cliente, con los booleanos de MySQL (0/1) convertidos
const formatCargo = (item: any) => ({
    ...item,
    is_fragile: Boolean(Number(item.is_fragile)),
    needs_cover: Boolean(Number(item.needs_cover)),
    pickup_has_elevator: toBool(item.pickup_has_elevator),
    destination_has_elevator: toBool(item.destination_has_elevator),
});

const normalizeBigInt = (obj: any): any => JSON.parse(
    JSON.stringify(obj, (_, value) => typeof value === "bigint" ? Number(value) : value)
);

// Un conductor ve las solicitudes vigentes que caben en su vehículo, que no descartó y que no son suyas.
// El celular del cliente no se muestra: cliente y conductor se hablan por el chat del viaje
export const getNearbyClientRequests = async (idDriver: number, driverLat: number, driverLng: number) => {
    await assertDriverCanWork(idDriver);
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { vehicle_type: true, capacity_kg: true, capacity_m3: true } });
    const vehicle = car ?? { vehicle_type: "CARRY" as const, capacity_kg: null, capacity_m3: null };
    // Con capacidad propia declarada, la base trae también las de vehículos más grandes y se filtran abajo por tamaño
    const hasOwnCapacity = vehicle.capacity_kg !== null || vehicle.capacity_m3 !== null;
    const maxRank = hasOwnCapacity ? 4 : vehicleRank(vehicle.vehicle_type) + 1; // FIELD() de MySQL empieza en 1

    const rows = await prisma.$queryRaw<any[]>`
            SELECT
                CR.id,
                CR.id_client,
                CR.fare_offered,
                CR.payment_method,
                CR.pickup_description,
                CR.destination_description,
                CR.status,
                CR.update_at,
                CR.client_rating,
                CR.driver_rating,
                CR.cargo_description,
                CR.weight_kg,
                CR.height_cm,
                CR.width_cm,
                CR.length_cm,
                CR.cargo_category,
                CR.packages,
                CR.is_fragile,
                CR.needs_cover,
                CR.required_vehicle,
                CR.helpers,
                CR.pickup_floor,
                CR.pickup_has_elevator,
                CR.destination_floor,
                CR.destination_has_elevator,
                CR.scheduled_at,
                CR.expires_at,
                (
                    SELECT O.fare_offered FROM driver_trip_offers AS O
                    WHERE O.id_client_request = CR.id AND O.id_driver = ${idDriver} AND O.status = 'PENDING'
                    ORDER BY O.id DESC LIMIT 1
                ) AS my_offer,
                (
                    SELECT COUNT(*) FROM trip_photos AS TP
                    WHERE TP.id_client_request = CR.id AND TP.kind = 'CARGO'
                ) AS cargo_photos,
                JSON_OBJECT (
                    "x", ST_X(pickup_position),
                    "y", ST_Y(pickup_position)

                ) AS pickup_position,
                JSON_OBJECT (
                    "x", ST_X(destination_position),
                    "y", ST_Y(destination_position)

                ) AS destination_position,
                ST_Distance_Sphere(pickup_position, ST_GeomFromText(CONCAT('POINT(', ${driverLng}, ' ', ${driverLat}, ')'), 4326)) as distance,
                timestampdiff(MINUTE, CR.update_at, UTC_TIMESTAMP()) AS time_difference,
                JSON_OBJECT(
                    "name", U.name,
                    "lastname", U.lastname,
                    "image", U.image
                ) AS client
            FROM
                client_requests AS CR
            INNER JOIN
                users AS U
            ON
                U.id = CR.id_client
            WHERE
                CR.status = "CREATED"
                AND CR.expires_at > UTC_TIMESTAMP(3)
                AND FIELD(CR.required_vehicle, 'CARRY', 'ESTACAS', 'FURGON', 'CAMION') <= ${maxRank}
                AND CR.id_client <> ${idDriver}
                AND NOT EXISTS (
                    SELECT 1 FROM driver_dismissed_requests AS DD
                    WHERE DD.id_client_request = CR.id AND DD.id_driver = ${idDriver}
                )
            HAVING
                distance < 10000
            ORDER BY CR.scheduled_at IS NOT NULL, CR.scheduled_at, CR.created_at DESC
            LIMIT 50
    `;

    const data = rows.filter((row) => canCarry(vehicle, {
        weight_kg: row.weight_kg ?? undefined, length_cm: row.length_cm ?? undefined, width_cm: row.width_cm ?? undefined,
        height_cm: row.height_cm ?? undefined, packages: row.packages ?? undefined, required_vehicle: row.required_vehicle,
    }));
    if (!data.length) return [];

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json";

    let response;

    try {
        response = await axios.get(url, {
            params: {
                origins: `${driverLat},${driverLng}`,
                destinations: data.map(item => {
                    return `${item.pickup_position.y},${item.pickup_position.x}`
                }).join("|"),
                unit: "metric",
                // Textos en español ("15 min" y no "15 mins"); la app pone la coma decimal a los km
                language: "es-419",
                key: apiKey
            }
        });
    } catch (err) {
        throw new AppError("Error al conectar con la API de Google Distance", 500);
    }

    const body = response.data;

    if (body.status !== "OK") {
        throw new AppError(`Respuesta no válida del API de Google Distance: ${body.status}`, 500);
    }

    const elements = body.rows?.[0]?.elements;
    const ratings = await clientRatings(data.map((item) => item.id_client));

    const formatted = data.map((item, index) => ({
        ...formatCargo(item),
        client: {
            ...item.client,
            rating: ratingOf(ratings, item.id_client),
            image: item.client.image ? `http://${process.env.HOST}:${process.env.PORT}${item.client.image}` : null
        },
        google_distance_matrix: {
            status: elements[index]?.status ?? null,
            distance: elements[index]?.distance ?? null,
            duration: elements[index]?.duration ?? null
        }
    }));


    return normalizeBigInt(formatted);
}

// viewerId decide si va el código de entrega: solo lo ve el cliente, para dárselo a quien recibe
export const getByClientRequest = async (id: number, viewerId: number) => {
    const data = await prisma.$queryRaw<any[]>`
            SELECT
                CR.id,
                CR.id_client,
                CR.id_driver_assigned,
                CR.fare_offered,
                CR.fare_assigned,
                CR.payment_method,
                CR.commission,
                CR.commission_rate,
                CR.paid_at,
                CR.declared_value,
                CR.pickup_description,
                CR.destination_description,
                CR.cargo_description,
                CR.weight_kg,
                CR.height_cm,
                CR.width_cm,
                CR.length_cm,
                CR.status,
                CR.update_at,
                CR.cargo_category,
                CR.packages,
                CR.is_fragile,
                CR.needs_cover,
                CR.required_vehicle,
                CR.helpers,
                CR.pickup_floor,
                CR.pickup_has_elevator,
                CR.destination_floor,
                CR.destination_has_elevator,
                CR.sender_name,
                CR.sender_phone,
                CR.receiver_name,
                CR.receiver_phone,
                CR.scheduled_at,
                CR.expires_at,
                CR.canceled_by,
                CR.cancel_reason,
                JSON_OBJECT (
                    "x", ST_X(pickup_position),
                    "y", ST_Y(pickup_position)
                
                ) AS pickup_position,
                JSON_OBJECT (
                    "x", ST_X(destination_position),
                    "y", ST_Y(destination_position)
                
                ) AS destination_position,
                JSON_OBJECT(
                    "name", U.name,
                    "lastname", U.lastname,
                    "image", U.image
                ) AS client,
                JSON_OBJECT(
                    "name", D.name,
                    "lastname", D.lastname,
                    "image", D.image
                ) AS driver,
                JSON_OBJECT(
                    "brand", DCI.brand,
                    "color", DCI.color,
                    "plate", DCI.plate,
                    "vehicle_type", DCI.vehicle_type
                ) AS car
            FROM
                client_requests AS CR
            INNER JOIN
                users AS U
            ON
                U.id = CR.id_client
            LEFT JOIN
                users AS D
            ON
                D.id = CR.id_driver_assigned
            LEFT JOIN
                driver_car_info AS DCI
            ON
                DCI.id_driver = CR.id_driver_assigned
            WHERE
                CR.id = ${id}

    `;

    if (!data.length) return [];

    const [clients, drivers] = await Promise.all([clientRatings([data[0].id_client]), driverRatings(data[0].id_driver_assigned ? [data[0].id_driver_assigned] : [])]);

    const formatted = data.map((item, index) => ({
        ...formatCargo(item),
        client: {
            ...item.client,
            rating: ratingOf(clients, item.id_client),
            image: item.client.image ? `http://${process.env.HOST}:${process.env.PORT}${item.client.image}` : null
        },
        driver: {
            ...item.driver,
            rating: ratingOf(drivers, item.id_driver_assigned),
            image: item.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${item.driver.image}` : null
        }
    }));

    const trip = normalizeBigInt(formatted[0]);
    if (trip.id_client === viewerId) {
        const { delivery_code, delivery_code_attempts } = await prisma.clientRequests.findUniqueOrThrow({ where: { id }, select: { delivery_code: true, delivery_code_attempts: true } });
        trip.delivery_code = delivery_code;
        // El conductor agotó los intentos del código (o el viaje no tiene): el cliente puede confirmar él mismo
        trip.delivery_locked = !delivery_code || delivery_code_attempts >= MAX_DELIVERY_ATTEMPTS;
    }
    return trip;
}

export const getByClientAssigned = async (id_client: number) => {
    const data = await prisma.$queryRaw<any[]>`
         SELECT
            CR.id,
            CR.id_client,
            CR.id_driver_assigned,
            CR.fare_offered,
            CR.fare_assigned,
            CR.payment_method,
            CR.commission,
            CR.paid_at,
            CR.pickup_description,
            CR.destination_description,
            CR.status,
            CR.update_at,
            CR.client_rating,
            CR.driver_rating,
            JSON_OBJECT(
                'x', ST_X(pickup_position),
                'y', ST_Y(pickup_position)
            ) AS pickup_position,
            JSON_OBJECT(
                'x', ST_X(destination_position),
                'y', ST_Y(destination_position)
            ) AS destination_position,
            JSON_OBJECT(
                'name', U.name,
                'lastname', U.lastname,
                'image', U.image
            ) AS client,
            JSON_OBJECT(
                'name', D.name,
                'lastname', D.lastname,
                'image', D.image
            ) AS driver,
            JSON_OBJECT(
                'brand', DCI.brand,
                'color', DCI.color,
                'plate', DCI.plate
            ) AS car
        FROM
            client_requests AS CR
        INNER JOIN
            users AS U
        ON
            U.id = CR.id_client
        LEFT JOIN
            users AS D
        ON
            D.id = CR.id_driver_assigned
        LEFT JOIN
            driver_car_info AS DCI
        ON
            DCI.id_driver = CR.id_driver_assigned
        WHERE
            CR.id_client = ${id_client} AND CR.status = 'FINISHED'
        
    `;

    if (!data.length) return [];
    
    
    const formatted = data.map((item, index) => ({
        ...item,
        client: {
            ...item.client,
            image: item.client.image ? `http://${process.env.HOST}:${process.env.PORT}${item.client.image}` : null
        },
        driver: {
            ...item.driver,
            image: item.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${item.driver.image}` : null
        }
    }));

    return normalizeBigInt(formatted);
}

export const getByDriverAssigned = async (id_driver_assigned: number) => {
    const data = await prisma.$queryRaw<any[]>`
         SELECT
            CR.id,
            CR.id_client,
            CR.id_driver_assigned,
            CR.fare_offered,
            CR.fare_assigned,
            CR.payment_method,
            CR.commission,
            CR.paid_at,
            CR.pickup_description,
            CR.destination_description,
            CR.status,
            CR.update_at,
            CR.client_rating,
            CR.driver_rating,
            JSON_OBJECT(
                'x', ST_X(pickup_position),
                'y', ST_Y(pickup_position)
            ) AS pickup_position,
            JSON_OBJECT(
                'x', ST_X(destination_position),
                'y', ST_Y(destination_position)
            ) AS destination_position,
            JSON_OBJECT(
                'name', U.name,
                'lastname', U.lastname,
                'image', U.image
            ) AS client,
            JSON_OBJECT(
                'name', D.name,
                'lastname', D.lastname,
                'image', D.image
            ) AS driver,
            JSON_OBJECT(
                'brand', DCI.brand,
                'color', DCI.color,
                'plate', DCI.plate
            ) AS car
        FROM
            client_requests AS CR
        INNER JOIN
            users AS U
        ON
            U.id = CR.id_client
        LEFT JOIN
            users AS D
        ON
            D.id = CR.id_driver_assigned
        LEFT JOIN
            driver_car_info AS DCI
        ON
            DCI.id_driver = CR.id_driver_assigned
        WHERE
            CR.id_driver_assigned = ${id_driver_assigned} AND CR.status = 'FINISHED'
        
    `;

    if (!data.length) return [];
    
    
    const formatted = data.map((item, index) => ({
        ...item,
        client: {
            ...item.client,
            image: item.client.image ? `http://${process.env.HOST}:${process.env.PORT}${item.client.image}` : null
        },
        driver: {
            ...item.driver,
            image: item.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${item.driver.image}` : null
        }
    }));

    return normalizeBigInt(formatted);
}
