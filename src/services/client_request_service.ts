import prisma from "../database/prismaClient.js";
import { AppError } from "../utils/App.Error.js";

export const getTimeAndDistance = async () => {

    const values = await prisma.timeAndDistanceValues.findUnique({
        where: { id: 1 }
    });

    if (!values) {
        throw new AppError("Valores de la tarifa no configurados", 500);
    }

    const recommendedValue = 
    (values.km_value * 1)
    + (values.min_value * 5)
    + (values.weight_rate * 70)
    + (values.size_rate * 0.36);

    return {
        recommended_value: recommendedValue
    }
    
}