import prisma from "../database/prismaClient.js";

// Da el rol ADMIN a una cuenta que ya existe, para que pueda entrar al panel (/admin) con su correo y contraseña.
// Uso: npm run admin:grant -- correo@ejemplo.com
const email = process.argv[2]?.trim().toLowerCase();

const main = async () => {
    if (!email) {
        throw new Error("Falta el correo. Ejemplo: npm run admin:grant -- correo@ejemplo.com");
    }
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true } });
    if (!user) {
        throw new Error(`No hay una cuenta con el correo ${email}. Créala primero desde la app`);
    }
    await prisma.userHasRole.upsert({
        where: { id_user_id_rol: { id_user: user.id, id_rol: "ADMIN" } },
        update: {},
        create: { id_user: user.id, id_rol: "ADMIN" },
    });
    console.log(`Listo: ${email} ya puede entrar al panel en /admin`);
    if (!user.password) {
        console.log("Esa cuenta no tiene contraseña (se creó con Google): crea una con \"¿Olvidaste tu contraseña?\" en la app");
    }
};

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
