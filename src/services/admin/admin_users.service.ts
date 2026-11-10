import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { disconnectUser } from "../../sockets/socketHandler.js";
import { photoPath } from "../../utils/photoStorage.js";
import { logAdminAction } from "./admin_audit.service.js";

// Usuarios en el panel: buscar, ver su detalle, suspender, reactivar y anonimizar a pedido de la persona

const PAGE_SIZE = 25;
const UPLOADS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../public/uploads/users");

const fullName = (user: { name: string; lastname: string }) => `${user.name} ${user.lastname}`.trim();

export const listUsers = async (filters: { q?: string | undefined; role?: "CLIENT" | "DRIVER" | "ADMIN" | undefined; status?: "ACTIVE" | "SUSPENDED" | undefined; page: number }) => {
    const q = filters.q?.trim();
    const where = {
        anonymized_at: null,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.role ? { roles: { some: { id_rol: filters.role } } } : {}),
        ...(q ? {
            OR: [
                { name: { contains: q } }, { lastname: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } },
                ...(Number.isInteger(Number(q)) ? [{ id: Number(q) }] : []),
            ],
        } : {}),
    };
    const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where, orderBy: { id: "desc" }, skip: (filters.page - 1) * PAGE_SIZE, take: PAGE_SIZE,
            select: {
                id: true, name: true, lastname: true, email: true, phone: true, status: true, created_at: true,
                roles: { select: { id_rol: true } },
                driverCarInfo: { select: { vehicle_type: true, plate: true, approval_status: true } },
            },
        }),
    ]);
    return {
        total, page: filters.page, page_size: PAGE_SIZE,
        items: users.map((user) => ({
            id: user.id, name: fullName(user), email: user.email, phone: user.phone, status: user.status, created_at: user.created_at,
            roles: user.roles.map((role) => role.id_rol), vehicle: user.driverCarInfo,
        })),
    };
}

export const getUserDetail = async (id: number) => {
    const user = await prisma.user.findUnique({
        where: { id },
        select: {
            id: true, name: true, lastname: true, email: true, phone: true, status: true, status_reason: true, anonymized_at: true,
            email_verified: true, google_id: true, created_at: true,
            roles: { select: { id_rol: true } },
            driverCarInfo: { select: { vehicle_type: true, brand: true, plate: true, approval_status: true } },
        },
    });
    if (!user) {
        throw new AppError("El usuario no existe", 404);
    }
    const [asClient, asDriver, ratingAsDriver, ratingAsClient, recent, incidents] = await Promise.all([
        prisma.clientRequests.groupBy({ by: ["status"], where: { id_client: id }, _count: { _all: true } }),
        prisma.clientRequests.groupBy({ by: ["status"], where: { id_driver_assigned: id }, _count: { _all: true } }),
        prisma.clientRequests.aggregate({ where: { id_driver_assigned: id, driver_rating: { not: null } }, _avg: { driver_rating: true }, _count: { driver_rating: true } }),
        prisma.clientRequests.aggregate({ where: { id_client: id, client_rating: { not: null } }, _avg: { client_rating: true }, _count: { client_rating: true } }),
        prisma.clientRequests.findMany({
            where: { OR: [{ id_client: id }, { id_driver_assigned: id }] }, orderBy: { id: "desc" }, take: 10,
            select: { id: true, status: true, fare_offered: true, fare_assigned: true, currency: true, country_code: true, created_at: true, id_client: true, pickup_description: true, destination_description: true },
        }),
        prisma.incidentReport.count({ where: { client_request: { OR: [{ id_client: id }, { id_driver_assigned: id }] } } }),
    ]);
    const counts = (rows: { status: string; _count: { _all: number } }[]) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const { google_id, ...rest } = user;
    return {
        ...rest,
        name: fullName(user),
        has_google: google_id !== null,
        roles: user.roles.map((role) => role.id_rol),
        vehicle: user.driverCarInfo,
        trips_as_client: counts(asClient),
        trips_as_driver: counts(asDriver),
        rating_as_driver: ratingAsDriver._count.driver_rating ? { average: ratingAsDriver._avg.driver_rating, count: ratingAsDriver._count.driver_rating } : null,
        rating_as_client: ratingAsClient._count.client_rating ? { average: ratingAsClient._avg.client_rating, count: ratingAsClient._count.client_rating } : null,
        incidents,
        recent_trips: recent.map((trip) => ({ ...trip, role: trip.id_client === id ? "CLIENT" : "DRIVER" })),
    };
}

const findEditableUser = async (adminId: number, id: number) => {
    if (adminId === id) {
        throw new AppError("No puedes hacer esto con tu propia cuenta", 409);
    }
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, anonymized_at: true } });
    if (!user) {
        throw new AppError("El usuario no existe", 404);
    }
    if (user.anonymized_at) {
        throw new AppError("Esta cuenta ya fue anonimizada", 409);
    }
    return user;
}

// Suspender corta al instante: la siguiente petición de la app responde ACCOUNT_SUSPENDED y su socket se cierra.
// Si era conductor, deja de estar disponible
export const suspendUser = async (adminId: number, id: number, reason: string) => {
    const user = await findEditableUser(adminId, id);
    if (user.status === "SUSPENDED") {
        throw new AppError("La cuenta ya está suspendida", 409);
    }
    await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { status: "SUSPENDED", status_reason: reason, notification_token: null } });
        await tx.$executeRaw`DELETE FROM drivers_position WHERE id_driver = ${id}`;
        await logAdminAction(tx, adminId, "SUSPEND_USER", "user", id, reason);
    });
    disconnectUser(id, { reason });
    return { id, status: "SUSPENDED", status_reason: reason };
}

export const reactivateUser = async (adminId: number, id: number) => {
    const user = await findEditableUser(adminId, id);
    if (user.status === "ACTIVE") {
        throw new AppError("La cuenta ya está activa", 409);
    }
    await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { status: "ACTIVE", status_reason: null } });
        await logAdminAction(tx, adminId, "REACTIVATE_USER", "user", id);
    });
    return { id, status: "ACTIVE" };
}

// Borrar a pedido de la persona (Ley 1581 de 2012): se quitan sus datos personales y se conservan sus viajes,
// pagos y calificaciones, que otros usuarios y la contabilidad necesitan. No se puede deshacer.
// No se permite con un viaje en curso
export const anonymizeUser = async (adminId: number, id: number) => {
    await findEditableUser(adminId, id);
    const active = await prisma.clientRequests.count({
        where: { OR: [{ id_client: id }, { id_driver_assigned: id }], status: { in: ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "TRAVELING"] } },
    });
    if (active > 0) {
        throw new AppError("Tiene un viaje en curso: espera a que termine o cancélalo antes de anonimizar la cuenta", 409);
    }
    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: {
                name: "Usuario", lastname: "eliminado", email: `eliminado-${id}@fleteya.invalid`, phone: "",
                image: null, password: null, google_id: null, notification_token: null,
                status: "SUSPENDED", status_reason: "Cuenta eliminada a pedido del usuario", anonymized_at: new Date(),
            },
        });
        // Las búsquedas abiertas se cancelan; los contactos de entrega que escribió también son datos personales
        await tx.clientRequests.updateMany({
            where: { id_client: id, status: "CREATED" },
            data: { status: "CANCELED", canceled_by: adminId, cancel_reason: "Cuenta eliminada" },
        });
        await tx.clientRequests.updateMany({
            where: { id_client: id },
            data: { sender_name: null, sender_phone: null, receiver_name: null, receiver_phone: null },
        });
        await tx.driverCarInfo.updateMany({
            where: { id_driver: id },
            data: { license_number: null, property_card_number: null, plate: "ELIMINADO" },
        });
        await tx.vehiclePhoto.deleteMany({ where: { id_driver: id } });
        await tx.$executeRaw`DELETE FROM drivers_position WHERE id_driver = ${id}`;
        await tx.passwordResetCode.deleteMany({ where: { id_user: id } });
        await logAdminAction(tx, adminId, "ANONYMIZE_USER", "user", id);
    });
    disconnectUser(id, { reason: "Cuenta eliminada" });
    // Foto de perfil y fotos del vehículo (muestran la placa) se borran del disco; si falla, ya nadie las puede
    // encontrar porque sus rutas se quitaron de la base
    await fs.rm(path.join(UPLOADS_ROOT, String(id)), { recursive: true, force: true }).catch(() => {});
    await fs.rm(photoPath(`vehicles/${id}`, ""), { recursive: true, force: true }).catch(() => {});
    return { id, anonymized: true };
}
