import axios from "axios";
import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";

export const getTimeAndDistance = async (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number
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
    + (values.weight_rate * 70)
    + (values.size_rate * 0.36);

    return {
        distance:{
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