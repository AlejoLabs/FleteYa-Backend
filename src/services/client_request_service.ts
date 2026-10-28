import axios from "axios";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import type { AssignDriverInput, CancelClientRequestInput, CreateClientRequestInput, RaiseFareInput, UpdateClientRatingInput, UpdateClientRequestInput, UpdateDriverRatingInput } from "../validators/client_request.validator.js";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";
import { deny } from "../utils/authorization.js";
import { biggerVehicle, requiredVehicleFor, vehicleRank } from "../utils/vehicles.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";

// Una búsqueda "Ahora" dura 10 minutos (se reinicia si el cliente sube el precio).
// Un flete programado recibe ofertas hasta 30 minutos antes de la hora
export const SEARCH_DURATION_MS = 10 * 60 * 1000;
const SCHEDULED_CLOSE_BEFORE_MS = 30 * 60 * 1000;

const ACTIVE_STATUSES: ClientRequestStatus[] = ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"];

export const createClientRequest = async (data: CreateClientRequestInput & { id_client: number }) => {
    // Si el cliente eligió un vehículo, se usa el mayor entre ese y el mínimo en el que cabe la carga
    const minimum = requiredVehicleFor(data);
    const requiredVehicle = data.vehicle_type ? biggerVehicle(minimum, data.vehicle_type) : minimum;
    const expiresAt = data.scheduled_at
        ? new Date(data.scheduled_at.getTime() - SCHEDULED_CLOSE_BEFORE_MS)
        : new Date(Date.now() + SEARCH_DURATION_MS);

    try {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
            INSERT INTO client_requests (
                id_client,
                fare_offered,
                pickup_position,
                destination_position,
                pickup_description,
                destination_description,
                cargo_description,
                weight_kg,
                height_cm,
                width_cm,
                length_cm,
                status,
                created_at,
                update_at
            )
            VALUES (
                ${data.id_client},
                ${data.fare_offered},
                ST_GeomFromText(CONCAT('POINT(', ${data.pickup_lng}, ' ', ${data.pickup_lat}, ')'), 4326),
                ST_GeomFromText(CONCAT('POINT(', ${data.destination_lng}, ' ', ${data.destination_lat}, ')'), 4326),
                ${data.pickup_description},
                ${data.destination_description},
                ${data.cargo_description ?? null},
                ${data.weight_kg ?? null},
                ${data.height_cm ?? null},
                ${data.width_cm ?? null},
                ${data.length_cm ?? null},
                'CREATED',
                NOW(),
                NOW()
            )
        `;

            const [row] = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT LAST_INSERT_ID() as id
        `;
            const id = Number(row!.id);

            // Los campos nuevos van con el cliente de Prisma: así las fechas se guardan en UTC igual que el resto
            await tx.clientRequests.update({
                where: { id },
                data: {
                    cargo_category: data.cargo_category,
                    packages: data.packages,
                    is_fragile: data.is_fragile,
                    needs_cover: data.needs_cover,
                    required_vehicle: requiredVehicle,
                    helpers: data.helpers,
                    pickup_floor: data.pickup_floor ?? null,
                    pickup_has_elevator: data.pickup_has_elevator ?? null,
                    destination_floor: data.destination_floor ?? null,
                    destination_has_elevator: data.destination_has_elevator ?? null,
                    sender_name: data.sender_name || null,
                    sender_phone: data.sender_phone || null,
                    receiver_name: data.receiver_name || null,
                    receiver_phone: data.receiver_phone || null,
                    scheduled_at: data.scheduled_at ?? null,
                    expires_at: expiresAt,
                }
            });
            return id;
        })

        return result;
    } catch (e) {
        throw new AppError(`Error al crear la solicitud de viaje: ${e}`, 500);
    }

}

const findTripOrFail = async (id: number) => {
    const trip = await prisma.clientRequests.findUnique({
        where: { id },
        select: { id: true, id_client: true, id_driver_assigned: true, status: true, fare_offered: true, scheduled_at: true, expires_at: true }
    });
    if (!trip) {
        throw new AppError("La solicitud de viaje no existe", 404);
    }
    return trip;
}

// Solo el cliente dueño o el conductor asignado pueden ver o tocar un viaje
export const assertTripParticipant = async (id: number, userId: number) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId && trip.id_driver_assigned !== userId) {
        throw deny(userId, "ver-viaje", `client_requests/${id}`);
    }
    return trip;
}

// Las ofertas de un viaje solo las ve el cliente que lo pidió
export const assertTripOwner = async (id: number, userId: number) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "ver-ofertas", `client_requests/${id}`);
    }
    return trip;
}

export const assignDriver = async (userId: number, data: AssignDriverInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "asignar-conductor", `client_requests/${data.id}`);
    }
    // Antes que la oferta: un viaje ya asignado, cancelado o vencido responde "no disponible", no "sin oferta"
    if (clientRequest.status !== "CREATED") {
        throw new AppError("Este viaje ya no está disponible para asignar", 409);
    }

    // El precio sale de la oferta pendiente guardada, no de lo que mande la app: así nadie asigna un viaje con otro valor
    const offer = await prisma.driverTripOffer.findFirst({
        where: { id_client_request: data.id, id_driver: data.id_driver_assigned, status: "PENDING" },
        orderBy: { created_at: "desc" }
    });
    if (!offer) {
        throw new AppError("Ese conductor no tiene una oferta vigente para este viaje", 400);
    }

    const rejectedDrivers = await prisma.$transaction(async (tx) => {
        // updateMany con status CREATED y sin vencer evita que dos aceptaciones simultáneas asignen dos conductores
        const result = await tx.clientRequests.updateMany({
            where: { id: data.id, id_client: userId, status: "CREATED", expires_at: { gt: new Date() } },
            data: {
                id_driver_assigned: data.id_driver_assigned,
                status: "ACCEPTED",
                fare_assigned: offer.fare_offered,
            }
        });
        if (result.count === 0) {
            throw new AppError("Este viaje ya no está disponible para asignar", 409);
        }

        await tx.driverTripOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
        const others = await tx.driverTripOffer.findMany({
            where: { id_client_request: data.id, status: "PENDING" },
            select: { id_driver: true }
        });
        await tx.driverTripOffer.updateMany({
            where: { id_client_request: data.id, status: "PENDING" },
            data: { status: "REJECTED" }
        });
        return [...new Set(others.map((o) => o.id_driver))];
    });

    // Los demás conductores que ofertaron se enteran de que eligieron a otro, y la solicitud sale de la lista de todos
    for (const idDriver of rejectedDrivers) {
        notifyUser(idDriver, `offer_status/${idDriver}`, { id_client_request: data.id, status: "REJECTED", reason: "OTHER_DRIVER" });
    }
    notifyDrivers("client_request_removed", { id_client_request: data.id });

    return prisma.clientRequests.findUnique({
        where: { id: data.id },
        select: { id: true, id_client: true, id_driver_assigned: true, fare_assigned: true, status: true }
    });
}

// Estados a los que el conductor asignado puede avanzar desde cada estado. Para terminar hay que pasar por
// "Carga recogida" (TRAVELING); cancelar va por su propio endpoint
const NEXT_STATUSES: Record<string, ClientRequestStatus[]> = {
    ACCEPTED: ["ON_THE_WAY", "ARRIVED"],
    ON_THE_WAY: ["ARRIVED"],
    ARRIVED: ["TRAVELING"],
    TRAVELING: ["FINISHED"],
};

export const updateStatus = async (userId: number, data: UpdateClientRequestInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "cambiar-estado", `client_requests/${data.id}`);
    }

    const nextStatus = data.status as ClientRequestStatus;
    if (!(NEXT_STATUSES[clientRequest.status] ?? []).includes(nextStatus)) {
        throw new AppError(`No se puede pasar de ${clientRequest.status} a ${nextStatus}`, 409);
    }

    // Con el estado actual en el where, una cancelación simultánea no queda pisada por este cambio
    const result = await prisma.clientRequests.updateMany({
        where: { id: data.id, status: clientRequest.status },
        data: { status: nextStatus }
    });
    if (result.count === 0) {
        throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
    }
    return prisma.clientRequests.findUnique({ where: { id: data.id } });
}

// El cliente sube su precio mientras busca. Una búsqueda "Ahora" vuelve a tener 10 minutos
export const raiseFare = async (userId: number, id: number, data: RaiseFareInput) => {
    const trip = await findTripOrFail(id);
    if (trip.id_client !== userId) {
        throw deny(userId, "subir-precio", `client_requests/${id}`);
    }
    if (data.fare_offered <= trip.fare_offered) {
        throw new AppError("El nuevo precio debe ser mayor al actual", 400);
    }

    const expiresAt = trip.scheduled_at ? trip.expires_at : new Date(Date.now() + SEARCH_DURATION_MS);
    const result = await prisma.clientRequests.updateMany({
        where: { id, status: "CREATED", expires_at: { gt: new Date() } },
        data: { fare_offered: data.fare_offered, expires_at: expiresAt }
    });
    if (result.count === 0) {
        throw new AppError("Esta búsqueda ya terminó", 409);
    }

    notifyDrivers("client_request_updated", { id_client_request: id, fare_offered: data.fare_offered });
    return { id, fare_offered: data.fare_offered, expires_at: expiresAt };
}

// Quién puede cancelar y en qué estados. Con la carga ya recogida no se cancela desde la app
const CLIENT_CANCELABLE: ClientRequestStatus[] = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"];
const DRIVER_CANCELABLE: ClientRequestStatus[] = ["ACCEPTED", "ON_THE_WAY", "ARRIVED"];

export const cancelClientRequest = async (userId: number, id: number, data: CancelClientRequestInput) => {
    const trip = await findTripOrFail(id);
    const isClient = trip.id_client === userId;
    const isDriver = trip.id_driver_assigned === userId;
    if (!isClient && !isDriver) {
        throw deny(userId, "cancelar-viaje", `client_requests/${id}`);
    }

    const allowed = isClient ? CLIENT_CANCELABLE : DRIVER_CANCELABLE;
    if (trip.status === "TRAVELING") {
        throw new AppError("La carga ya fue recogida: termina el viaje para cerrarlo", 409);
    }
    if (!allowed.includes(trip.status)) {
        throw new AppError("Este viaje ya no se puede cancelar", 409);
    }

    await prisma.$transaction(async (tx) => {
        const result = await tx.clientRequests.updateMany({
            where: { id, status: trip.status },
            data: { status: "CANCELED", canceled_by: userId, cancel_reason: data.reason }
        });
        if (result.count === 0) {
            throw new AppError("El viaje cambió mientras tanto; vuelve a cargarlo", 409);
        }
        await tx.driverTripOffer.updateMany({
            where: { id_client_request: id, status: "PENDING" },
            data: { status: "EXPIRED" }
        });
    });

    const payload = { id_client_request: id, canceled_by: isClient ? "CLIENT" : "DRIVER", reason: data.reason };
    if (trip.status === "CREATED") {
        notifyDrivers("client_request_removed", { id_client_request: id });
    } else {
        const otherUser = isClient ? trip.id_driver_assigned! : trip.id_client;
        notifyUser(otherUser, `trip_canceled/${id}`, payload);
    }
    return { id, status: "CANCELED", ...payload };
}

// "No me interesa": la solicitud deja de aparecerle a ese conductor y se retira su oferta si tenía una
export const dismissClientRequest = async (idDriver: number, id: number) => {
    const trip = await findTripOrFail(id);
    await prisma.driverDismissedRequest.upsert({
        where: { id_driver_id_client_request: { id_driver: idDriver, id_client_request: id } },
        create: { id_driver: idDriver, id_client_request: id },
        update: {}
    });
    const withdrawn = await prisma.driverTripOffer.updateMany({
        where: { id_client_request: id, id_driver: idDriver, status: "PENDING" },
        data: { status: "WITHDRAWN" }
    });
    if (withdrawn.count > 0) {
        notifyUser(trip.id_client, `created_driver_offer/${id}`, { id_client_request: id });
    }
    return { id_client_request: id, dismissed: true };
}

// Corre cada 30 segundos desde server.ts: vence las búsquedas sin conductor y avisa al cliente y a los conductores
export const expireStaleRequests = async () => {
    const now = new Date();
    const stale = await prisma.clientRequests.findMany({
        where: {
            status: "CREATED",
            OR: [
                { expires_at: { lte: now } },
                // Solicitudes creadas antes de la Fase 3, que no tienen fecha de vencimiento
                { expires_at: null, update_at: { lte: new Date(now.getTime() - SEARCH_DURATION_MS) } }
            ]
        },
        select: { id: true, id_client: true },
        take: 200
    });

    for (const trip of stale) {
        const result = await prisma.clientRequests.updateMany({
            where: { id: trip.id, status: "CREATED" },
            data: { status: "EXPIRED" }
        });
        if (result.count === 0) continue;
        await prisma.driverTripOffer.updateMany({
            where: { id_client_request: trip.id, status: "PENDING" },
            data: { status: "EXPIRED" }
        });
        notifyUser(trip.id_client, `client_request_expired/${trip.id}`, { id_client_request: trip.id });
        notifyDrivers("client_request_removed", { id_client_request: trip.id });
    }
    if (stale.length) console.log(`[expiracion] ${stale.length} solicitudes vencidas`);
}

// Búsquedas y viajes en curso del usuario, como cliente o como conductor: alimenta "Próximos fletes"
// y permite volver a la pantalla correcta si la app se cerró a mitad de un viaje
export const getMyActiveTrips = async (userId: number) => {
    const trips = await prisma.clientRequests.findMany({
        where: {
            OR: [
                { id_client: userId, status: { in: ["CREATED", ...ACTIVE_STATUSES] } },
                { id_driver_assigned: userId, status: { in: ACTIVE_STATUSES } }
            ]
        },
        select: {
            id: true, id_client: true, id_driver_assigned: true, status: true,
            fare_offered: true, fare_assigned: true,
            pickup_description: true, destination_description: true,
            cargo_category: true, cargo_description: true, required_vehicle: true,
            scheduled_at: true, expires_at: true, created_at: true
        },
        orderBy: [{ scheduled_at: "asc" }, { created_at: "desc" }],
        take: 50
    });
    return trips.map((trip) => ({ ...trip, role: trip.id_client === userId ? "CLIENT" : "DRIVER" }));
}

// El conductor califica al cliente y viceversa, y solo cuando el viaje terminó
export const updateClientRating = async (userId: number, data: UpdateClientRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_driver_assigned !== userId) {
        throw deny(userId, "calificar-cliente", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            client_rating: data.client_rating
        }
    });

    return updatedClientRequest;
}

export const updateDriverRating = async (userId: number, data: UpdateDriverRatingInput) => {
    const clientRequest = await findTripOrFail(data.id);

    if (clientRequest.id_client !== userId) {
        throw deny(userId, "calificar-conductor", `client_requests/${data.id}`);
    }
    if (clientRequest.status !== "FINISHED") {
        throw new AppError("Solo se puede calificar un viaje finalizado", 409);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            driver_rating: data.driver_rating
        }
    });

    return updatedClientRequest;
}

export const getTimeAndDistance = async (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number,
    weight: number,
    size: number
) => {

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json";

    let response;

    try {
        response = await axios.get(url, {
            params: {
                origins: `${originLat},${originLng}`,
                destinations: `${destinationLat},${destinationLng}`,
                unit: "metric",
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

    const element = body.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
        throw new AppError(`No se puede calcular la distancia y el tiempo`, 500);
    }

    const distanceValue = element.distance.value; // en metros
    const durationValue = element.duration.value; // en segundos

    const km = distanceValue / 1000; // convertir a kilómetros
    const min = durationValue / 60; // convertir a minutos

    const values = await prisma.timeAndDistanceValues.findUnique({
        where: { id: 1 }
    });

    if (!values) {
        throw new AppError("Valores de la tarifa no configurados", 500);
    }

    const recommendedValue =
        (values.km_value * km)
        + (values.min_value * min)
        + (values.weight_rate * weight)
        + (values.size_rate * size);

    return {
        distance: {
            text: element.distance.text,
            value: km
        },
        duration: {
            text: element.duration.text,
            value: min
        },
        origin_address: body.origin_addresses?.[0] || "",
        destination_address: body.destination_addresses?.[0] || "",
        recommended_value: recommendedValue
    }

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

// Un conductor ve las solicitudes vigentes que caben en su vehículo, que no descartó y que no son suyas.
// El celular del cliente no se muestra aquí: solo lo ve el conductor asignado
export const getNearbyClientRequests = async (idDriver: number, driverLat: number, driverLng: number) => {
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { vehicle_type: true } });
    const maxRank = vehicleRank(car?.vehicle_type ?? "CARRY") + 1; // FIELD() de MySQL empieza en 1

    const data = await prisma.$queryRaw<any[]>`
            SELECT
                CR.id,
                CR.id_client,
                CR.fare_offered,
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
                JSON_OBJECT (
                    "x", ST_X(pickup_position),
                    "y", ST_Y(pickup_position)

                ) AS pickup_position,
                JSON_OBJECT (
                    "x", ST_X(destination_position),
                    "y", ST_Y(destination_position)

                ) AS destination_position,
                ST_Distance_Sphere(pickup_position, ST_GeomFromText(CONCAT('POINT(', ${driverLng}, ' ', ${driverLat}, ')'), 4326)) as distance,
                timestampdiff(MINUTE, CR.update_at, NOW()) AS time_difference,
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

    const formatted = data.map((item, index) => ({
        ...formatCargo(item),
        client: {
            ...item.client,
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

export const getByClientRequest = async (id: number) => {
    const data = await prisma.$queryRaw<any[]>`
            SELECT
                CR.id,
                CR.id_client,
                CR.id_driver_assigned,
                CR.fare_offered,
                CR.fare_assigned,
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
                    "phone", U.phone,
                    "image", U.image
                ) AS client,
                JSON_OBJECT(
                    "name", D.name,
                    "lastname", D.lastname,
                    "phone", D.phone,
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


    const formatted = data.map((item, index) => ({
        ...formatCargo(item),
        client: {
            ...item.client,
            image: item.client.image ? `http://${process.env.HOST}:${process.env.PORT}${item.client.image}` : null
        },
        driver: {
            ...item.driver,
            image: item.driver.image ? `http://${process.env.HOST}:${process.env.PORT}${item.driver.image}` : null
        }
    }));


    return normalizeBigInt(formatted[0]);
}

const normalizeBigInt = (obj: any): any => JSON.parse(
    JSON.stringify(obj, (_, value) => typeof value === "bigint" ? Number(value) : value)
);


export const getByClientAssigned = async (id_client: number) => {
    const data = await prisma.$queryRaw<any[]>`
         SELECT
            CR.id,
            CR.id_client,
            CR.id_driver_assigned,
            CR.fare_offered,
            CR.fare_assigned,
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
                'phone', U.phone,
                'image', U.image
            ) AS client,
            JSON_OBJECT(
                'name', D.name,
                'lastname', D.lastname,
                'phone', D.phone,
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
                'phone', U.phone,
                'image', U.image
            ) AS client,
            JSON_OBJECT(
                'name', D.name,
                'lastname', D.lastname,
                'phone', D.phone,
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