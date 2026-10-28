// Cambios directos en la base de datos para las pruebas. Lo llama dbHelper() de api.mjs:
//   expire <id>              adelanta el vencimiento de una solicitud
//   code <correo> <código>   crea un código de restablecimiento conocido
//   google-user <correo>     crea una cuenta "de Google" sin contraseña
//   delete <correo>...       borra cuentas de prueba y su vehículo
import crypto from "crypto";
import prisma from "../../src/database/prismaClient.js";

const [command, ...args] = process.argv.slice(2);

if (command === "expire") {
    await prisma.clientRequests.update({ where: { id: Number(args[0]) }, data: { expires_at: new Date(Date.now() - 1000) } });
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
    await prisma.driverCarInfo.deleteMany({ where: { id_driver: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`borradas ${ids.length} cuentas de prueba`);
} else {
    console.error(`Comando desconocido: ${command}`);
    process.exitCode = 1;
}
await prisma.$disconnect();
