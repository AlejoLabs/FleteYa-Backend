import axios from "axios";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import type { AssignDriverInput, CreateClientRequestInput, UpdateClientRatingInput, UpdateClientRequestInput, UpdateDriverRatingInput } from "../validators/client_request.validator.js";
import type { ClientRequest } from "node:http";
import type { ClientRequestStatus } from "../generated/prisma/enums.js";

export const createClientRequest = async (data: CreateClientRequestInput) => {

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
                'CREATED',
                NOW(),
                NOW()
            )
        `;

            const [row] = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT LAST_INSERT_ID() as id
        `;
            return row?.id ? Number(row.id) : null;
        })

        return result;
    } catch (e) {
        throw new AppError(`Error al crear la solicitud de viaje: ${e}`, 500);
    }

}

export const assignDriver = async (data: AssignDriverInput) => {
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id }
    });

    if (!clientRequest) {
        throw new AppError("La solicitud de cliente no existe", 404);
    }
    const updatedDriverAssigned = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            id_driver_assigned: data.id_driver_assigned,
            status: "ACCEPTED",
            fare_assigned: data.fare_assigned,
        }
    });
    return updatedDriverAssigned;
}

export const updateStatus = async (data: UpdateClientRequestInput) => {
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id }
    });

    if (!clientRequest) {
        throw new AppError("La solicitud de cliente no existe", 404);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            status: data.status as ClientRequestStatus,
        }
    });
    return updatedClientRequest;
}

export const updateClientRating = async (data: UpdateClientRatingInput) => {
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id }
    });

    if (!clientRequest) {
        throw new AppError(`La solicitud de viaje no existe`, 404);
    }

    const updatedClientRequest = await prisma.clientRequests.update({
        where: { id: data.id },
        data: {
            client_rating: data.client_rating
        }
    });

    return updatedClientRequest;
}

export const updateDriverRating = async (data: UpdateDriverRatingInput) => {
    const clientRequest = await prisma.clientRequests.findUnique({
        where: { id: data.id }
    });

    if (!clientRequest) {
        throw new AppError(`La solicitud de viaje no existe`, 404);
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

export const getNearbyClientRequests = async (driverLat: number, driverLng: number) => {
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
                    "phone", U.phone,
                    "image", U.image
                ) AS client
            FROM
                client_requests AS CR
            INNER JOIN
                users AS U
            ON 
                U.id = CR.id_client
            WHERE
                timestampdiff(MINUTE, CR.update_at, NOW()) < 60 AND status = "CREATED"
            HAVING
                distance < 10000
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
        ...item,
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
                CR.status,
                CR.update_at,
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
                    "plate", DCI.plate
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
                CR.id = ${id} AND CR.status = "ACCEPTED"
           
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