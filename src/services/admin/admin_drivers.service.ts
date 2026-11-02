import prisma from "../../database/prismaClient.js";
import { AppError } from "../../utils/App.Error.js";
import { notifyUser, setDriverCanWork } from "../../sockets/socketHandler.js";
import { driverBlockReason, ELIGIBILITY_SELECT } from "../driver_eligibility.service.js";
import { sendPush } from "../../utils/push.js";
import { documentsStatus } from "../driver_car_info.service.js";
import { getVehiclePhotoFile, listVehiclePhotos } from "../vehicle_photo.service.js";
import { logAdminAction } from "./admin_audit.service.js";

// Verificación de conductores: el admin revisa vehículo, placa, fotos y documentos y aprueba o rechaza.
// Solo los aprobados con documentos vigentes ven y ofertan fletes (driver_eligibility.service)

type Approval = "PENDING" | "APPROVED" | "REJECTED";

// Los pendientes primero (los que esperan hace más tiempo arriba); después el resto, del más reciente al más viejo
export const listDrivers = async (approval?: Approval) => {
    const cars = await prisma.driverCarInfo.findMany({
        where: { ...(approval ? { approval_status: approval } : {}), driver: { anonymized_at: null } },
        orderBy: approval === "PENDING" ? { update_at: "asc" } : { update_at: "desc" },
        select: {
            id_driver: true, vehicle_type: true, brand: true, plate: true, approval_status: true, update_at: true,
            license_expires_at: true, soat_expires_at: true, techno_expires_at: true,
            driver: { select: { name: true, lastname: true, email: true, status: true, created_at: true } },
            _count: { select: { photos: true } },
        },
    });
    return cars.map((car) => ({
        id_driver: car.id_driver,
        name: `${car.driver.name} ${car.driver.lastname}`.trim(),
        email: car.driver.email,
        account_status: car.driver.status,
        registered_at: car.driver.created_at,
        vehicle_type: car.vehicle_type, brand: car.brand, plate: car.plate,
        approval_status: car.approval_status, updated_at: car.update_at,
        photos: car._count.photos,
        expired_documents: documentsStatus(car).filter((doc) => doc.status === "EXPIRED").map((doc) => doc.label),
    }));
}

export const getDriverReview = async (idDriver: number) => {
    const car = await prisma.driverCarInfo.findUnique({
        where: { id_driver: idDriver },
        include: { driver: { select: { name: true, lastname: true, email: true, phone: true, status: true, created_at: true } } },
    });
    if (!car) {
        throw new AppError("Este conductor no tiene vehículo registrado", 404);
    }
    const photos = await listVehiclePhotos(idDriver);
    const { driver, ...vehicle } = car;
    return {
        id_driver: idDriver,
        name: `${driver.name} ${driver.lastname}`.trim(),
        email: driver.email, phone: driver.phone, account_status: driver.status, registered_at: driver.created_at,
        vehicle,
        documents: documentsStatus(car),
        // El panel pide cada foto por su propia ruta, con la sesión del panel
        photos: photos.map((photo) => ({ id: photo.id, created_at: photo.created_at, url: `/admin/api/drivers/${idDriver}/photos/${photo.id}` })),
    };
}

export const getDriverPhotoFile = (idDriver: number, idPhoto: number) => getVehiclePhotoFile(idDriver, idPhoto);

const review = async (adminId: number, idDriver: number, status: "APPROVED" | "REJECTED", note: string | null) => {
    const car = await prisma.driverCarInfo.findUnique({ where: { id_driver: idDriver }, select: { approval_status: true } });
    if (!car) {
        throw new AppError("Este conductor no tiene vehículo registrado", 404);
    }
    await prisma.$transaction(async (tx) => {
        await tx.driverCarInfo.update({
            where: { id_driver: idDriver },
            data: { approval_status: status, approval_note: note, reviewed_at: new Date() },
        });
        // Rechazado: deja de estar disponible para recibir fletes
        if (status === "REJECTED") await tx.$executeRaw`DELETE FROM drivers_position WHERE id_driver = ${idDriver}`;
        await logAdminAction(tx, adminId, status === "APPROVED" ? "APPROVE_DRIVER" : "REJECT_DRIVER", "driver", idDriver, note ?? undefined);
    });
    // La app del conductor recarga su estado al instante si está abierta, y su socket ya puede (o no) mostrarlo en el mapa
    const updated = await prisma.driverCarInfo.findUniqueOrThrow({ where: { id_driver: idDriver }, select: ELIGIBILITY_SELECT });
    await setDriverCanWork(idDriver, driverBlockReason(updated) === null);
    notifyUser(idDriver, "driver_reviewed", { approval_status: status, approval_note: note });
    void sendPush(idDriver, status === "APPROVED"
        ? { type: "DRIVER_REVIEWED", title: "¡Tu cuenta de conductor está aprobada!", body: "Ya puedes ponerte disponible y recibir fletes." }
        : { type: "DRIVER_REVIEWED", title: "Revisa los datos de tu vehículo", body: note ?? "No pudimos aprobar tu vehículo." });
    return { id_driver: idDriver, approval_status: status, approval_note: note };
}

export const approveDriver = (adminId: number, idDriver: number) => review(adminId, idDriver, "APPROVED", null);

export const rejectDriver = (adminId: number, idDriver: number, note: string) => review(adminId, idDriver, "REJECTED", note);
