import prisma from "../database/prismaClient.js";

// Datos que la app necesita para funcionar en una base nueva: los roles y las tarifas del precio sugerido.
// Se puede correr varias veces: crea lo que falta y no toca lo que ya existe (las tarifas se cambian en la base).
// Uso: npm run db:seed (después de npx prisma migrate deploy)

const ROLES = [
    { id: "CLIENT", name: "Cliente", image: "https://cdn-icons-png.flaticon.com/512/6009/6009864.png", route: "client/home" },
    { id: "DRIVER", name: "Conductor", image: "https://cdn-icons-png.flaticon.com/512/1535/1535791.png", route: "driver/home" },
    { id: "ADMIN", name: "Admin", image: "https://cdn-icons-png.flaticon.com/512/2206/2206368.png", route: "admin/home" },
];

// Pesos por km y por minuto, por kg y por m³; la comisión de FleteYa (10 %) va incluida en el valor acordado
const FARE_VALUES = { id: 1, km_value: 2000, min_value: 150, weight_rate: 150, size_rate: 8000, commission_rate: 0.1 };

const main = async () => {
    for (const role of ROLES) {
        await prisma.role.upsert({ where: { id: role.id }, update: {}, create: role });
    }
    await prisma.timeAndDistanceValues.upsert({ where: { id: FARE_VALUES.id }, update: {}, create: FARE_VALUES });
    // Las tarifas por tipo de vehículo (vehicle_rates) ya las crea la migración de la Fase 7
    console.log(`Listo: ${ROLES.length} roles y tarifas base`);
};

main()
    .catch((error) => {
        console.error("No se pudieron crear los datos base:", error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
