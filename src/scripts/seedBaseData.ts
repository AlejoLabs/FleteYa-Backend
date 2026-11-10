import prisma from "../database/prismaClient.js";

// Datos que la app necesita para funcionar en una base nueva: los roles. Los países, monedas y tarifas de cada país
// los crea la migración de la Fase 9b (y se cambian desde el panel). Se puede correr varias veces: crea lo que falta.
// Uso: npm run db:seed (después de npx prisma migrate deploy)

const ROLES = [
    { id: "CLIENT", name: "Cliente", image: "https://cdn-icons-png.flaticon.com/512/6009/6009864.png", route: "client/home" },
    { id: "DRIVER", name: "Conductor", image: "https://cdn-icons-png.flaticon.com/512/1535/1535791.png", route: "driver/home" },
    { id: "ADMIN", name: "Admin", image: "https://cdn-icons-png.flaticon.com/512/2206/2206368.png", route: "admin/home" },
];

const main = async () => {
    for (const role of ROLES) {
        await prisma.role.upsert({ where: { id: role.id }, update: {}, create: role });
    }
    console.log(`Listo: ${ROLES.length} roles`);
};

main()
    .catch((error) => {
        console.error("No se pudieron crear los datos base:", error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
