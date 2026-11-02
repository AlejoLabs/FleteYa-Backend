import prisma from "../../database/prismaClient.js";
import type { Prisma } from "../../generated/prisma/client.js";

// Registro de cada acción del panel: quién hizo qué, sobre qué y cuándo. Se escribe dentro de la misma transacción
// que el cambio, así nunca queda un cambio sin su registro

type Db = Prisma.TransactionClient | typeof prisma;

export const logAdminAction = (
    db: Db, idAdmin: number, action: string, targetType: string, targetId: number | null, detail?: string,
) => db.adminAction.create({
    data: { id_admin: idAdmin, action, target_type: targetType, target_id: targetId, detail: detail?.slice(0, 500) ?? null },
});

const PAGE_SIZE = 50;

export const listAdminActions = async (page: number) => {
    const [total, rows] = await Promise.all([
        prisma.adminAction.count(),
        prisma.adminAction.findMany({
            orderBy: { id: "desc" },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
            include: { admin: { select: { name: true, lastname: true, email: true } } },
        }),
    ]);
    return {
        total, page, page_size: PAGE_SIZE,
        items: rows.map((row) => ({
            id: row.id, action: row.action, target_type: row.target_type, target_id: row.target_id, detail: row.detail,
            created_at: row.created_at, admin: `${row.admin.name} ${row.admin.lastname}`.trim(), admin_email: row.admin.email,
        })),
    };
}
