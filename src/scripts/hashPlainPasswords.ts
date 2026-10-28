import bcrypt from "bcryptjs";
import prisma from "../database/prismaClient.js";

// Usuarios creados a mano en la BD pueden tener la contraseña en texto plano, y entonces ni siquiera pueden entrar
// (el login compara con bcrypt). Este script los pasa a bcrypt conservando la misma contraseña.
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

const main = async () => {
    const users = await prisma.user.findMany({ select: { id: true, email: true, password: true } });
    const plain = users.filter((user) => !BCRYPT_PREFIX.test(user.password));

    if (plain.length === 0) {
        console.log("Todas las contraseñas ya están protegidas con bcrypt.");
        return;
    }

    for (const user of plain) {
        const hashed = await bcrypt.hash(user.password, 10);
        await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
        console.log(`Protegida la contraseña del usuario ${user.id} (${user.email}).`);
    }
}

main()
    .catch((err) => {
        console.error("No se pudieron proteger las contraseñas:", err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
