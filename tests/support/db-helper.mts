// Cambios directos en la base de datos para las pruebas. Lo llama dbHelper() de api.mjs:
//   expire <id>              adelanta el vencimiento de una solicitud
//   code <correo> <código>   crea un código de restablecimiento conocido
//   google-user <correo>     crea una cuenta "de Google" sin contraseña
//   age <id> <días>          hace que una solicitud parezca terminada hace N días
//   delete <correo>...       borra cuentas de prueba y su vehículo
//   grant-admin <correo>     da el rol ADMIN a una cuenta de prueba
//   delete-anonymized <id>   borra una cuenta de prueba que el panel anonimizó (su correo ya no es @prueba.com)
import crypto from "crypto";
import prisma from "../../src/database/prismaClient.js";

const [command, ...args] = process.argv.slice(2);

// Cuentas de prueba con todo lo que dejaron: vehículo, posición y registro del panel (si fueron admin)
async function removeTestUsers(ids: number[]) {
    if (!ids.length) return;
    await prisma.adminAction.deleteMany({ where: { id_admin: { in: ids } } });
    await prisma.$executeRawUnsafe(`DELETE FROM drivers_position WHERE id_driver IN (${ids.map(Number).join(",")})`);
    await prisma.driverCarInfo.deleteMany({ where: { id_driver: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

if (command === "expire") {
    await prisma.clientRequests.update({ where: { id: Number(args[0]) }, data: { expires_at: new Date(Date.now() - 1000) } });
} else if (command === "age") {
    await prisma.$executeRaw`UPDATE client_requests SET update_at = NOW(3) - INTERVAL ${Number(args[1])} DAY WHERE id = ${Number(args[0])}`;
} else if (command === "code") {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: args[0] } });
    await prisma.passwordResetCode.create({
        data: { id_user: user.id, code_hash: crypto.createHash("sha256").update(args[1]).digest("hex"), expires_at: new Date(Date.now() + 15 * 60000) }
    });
} else if (command === "google-user") {
    const user = await prisma.user.create({
        data: { name: "Prueba", lastname: "Google", email: args[0], phone: "", password: null, google_id: `test-${Date.now()}`, email_verified: true }
    });
    await prisma.userHasRole.create({ data: { id_user: user.id, id_rol: "CLIENT" } });
} else if (command === "delete") {
    // Solo cuentas creadas por las pruebas: nunca borra un correo que no sea de @prueba.com
    const emails = args.filter((email) => email.endsWith("@prueba.com"));
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await removeTestUsers(ids);
    console.log(`borradas ${ids.length} cuentas de prueba`);
} else if (command === "grant-admin") {
    if (!args[0]?.endsWith("@prueba.com")) throw new Error("Solo cuentas @prueba.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: args[0] } });
    await prisma.userHasRole.create({ data: { id_user: user.id, id_rol: "ADMIN" } });
} else if (command === "delete-anonymized") {
    // Solo si el panel la anonimizó en la última hora: el correo queda como eliminado-<id>@fleteya.invalid
    const id = Number(args[0]);
    const user = await prisma.user.findFirst({ where: { id, email: `eliminado-${id}@fleteya.invalid`, created_at: { gte: new Date(Date.now() - 3600000) } } });
    if (user) await removeTestUsers([id]);
} else {
    console.error(`Comando desconocido: ${command}`);
    process.exitCode = 1;
}
await prisma.$disconnect();
