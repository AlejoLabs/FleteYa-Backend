import prisma from "../database/prismaClient.js";

// Viajes que nunca se terminaron (la app aún no permite cancelar) quedan abiertos para siempre.
// Este script los pasa a CANCELED si llevan más de STALE_HOURS sin cambios.
const STALE_HOURS = Number(process.argv[2] ?? 6);
const OPEN_STATUSES = ["CREATED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"] as const;

const main = async () => {
    if (isNaN(STALE_HOURS) || STALE_HOURS <= 0) {
        throw new Error(`Horas inválidas: "${process.argv[2]}". Ejemplo: npm run trips:cancel-stale -- 6`);
    }

    const limit = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    const where = {
        status: { in: [...OPEN_STATUSES] },
        update_at: { lt: limit },
    };

    const byStatus = await prisma.clientRequests.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
    });

    if (byStatus.length === 0) {
        console.log(`No hay viajes abiertos con más de ${STALE_HOURS} h sin cambios.`);
        return;
    }

    const result = await prisma.clientRequests.updateMany({
        where,
        data: { status: "CANCELED" },
    });

    const detail = byStatus.map((row) => `${row.status}: ${row._count._all}`).join(", ");
    console.log(`Cancelados ${result.count} viajes con más de ${STALE_HOURS} h sin cambios (${detail}).`);
}

main()
    .catch((err) => {
        console.error("No se pudieron cancelar los viajes:", err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
