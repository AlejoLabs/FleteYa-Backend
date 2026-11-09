import axios from "axios";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";
import { deny } from "../utils/authorization.js";
import type { CreateClientRequestInput, RaiseFareInput } from "../validators/client_request.validator.js";
import { biggerVehicle, requiredVehicleFor } from "../utils/vehicles.js";
import type { VehicleType } from "../generated/prisma/enums.js";
import { notifyDrivers, notifyUser } from "../sockets/socketHandler.js";
import { SEARCH_DURATION_MS, SCHEDULED_CLOSE_BEFORE_MS, findTripOrFail } from "./client_request.shared.js";
import { alertNearbyDrivers } from "./request_alerts.service.js";

// Crear la solicitud y negociarla mientras busca conductor: subir el precio, "No me interesa" y la ruta sugerida

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
                UTC_TIMESTAMP(3),
                UTC_TIMESTAMP(3)
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
                    payment_method: data.payment_method,
                    declared_value: data.declared_value ?? null,
                }
            });
            return id;
        })

        // La lista y el inicio de los conductores se actualizan al instante; los que tienen la app cerrada reciben push
        notifyDrivers("created_client_request", { id_client_request: result });
        void alertNearbyDrivers(result);
        return result;
    } catch (e) {
        throw new AppError(`Error al crear la solicitud de viaje: ${e}`, 500);
    }

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

export const getTimeAndDistance = async (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number,
    weight: number,
    size: number,
    vehicle: VehicleType
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

    const element = body.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
        throw new AppError(`No se puede calcular la distancia y el tiempo`, 500);
    }

    const distanceValue = element.distance.value; // en metros
    const durationValue = element.duration.value; // en segundos

    const km = distanceValue / 1000; // convertir a kilómetros
    const min = durationValue / 60; // convertir a minutos

    const [values, rate] = await Promise.all([
        prisma.timeAndDistanceValues.findUnique({ where: { id: 1 } }),
        prisma.vehicleRate.findUnique({ where: { vehicle_type: vehicle } }),
    ]);

    if (!values || !rate) {
        throw new AppError("Valores de la tarifa no configurados", 500);
    }

    // Un vehículo más grande tiene una base mayor y cobra más por kilómetro y por minuto.
    // Cubre solo el transporte: la ayuda para cargar y descargar se negocia en la oferta
    const recommendedValue =
        rate.base_fare
        + ((values.km_value * km) + (values.min_value * min)) * rate.km_factor
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
        vehicle_type: vehicle,
        recommended_value: recommendedValue,
        commission_rate: values.commission_rate
    }

}
