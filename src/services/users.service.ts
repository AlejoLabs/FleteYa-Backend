import prisma from "../database/prismaClient.js";
import bcrypt from "bcrypt";
import type { createUserInput, updateUserInput } from "../validators/user.validator.js";
import { AppError } from "../utils/App.Error.js";
import { normalizeLanguage, type Language } from "../i18n/languages.js";
import { getCountry } from "./countries.service.js";


export const update = async (id: number, data: updateUserInput, file?: Express.Multer.File) => {
    const user = await prisma.user.findUnique({ where: { id: id } });

    if (!user) {
        throw new AppError("USER_NOT_FOUND", 404);
    }

    // Cambió el indicativo del celular: cambia su país (con eso, las reglas de placa y documentos)
    const countryCode = data.country_code ? (await getCountry(data.country_code)).code : user.country_code;

    let imagePath = user.image;

    if (file) {
        imagePath = `/uploads/users/${id}/${file.filename}`;
    }

    const updatedUser = await prisma.user.update({
        where: { id: id },
        data: {
            name: data.name ?? user.name,
            lastname: data.lastname ?? user.lastname,
            phone: data.phone ?? user.phone,
            country_code: countryCode,
            image: imagePath
        },
        include: {
            roles: {
                include: {role: true}
            }
        }
    });

     const formattedRoles = updatedUser.roles.map((userRole) => ({
        id: userRole.role.id,
        name: userRole.role.name,
        route: userRole.role.route,
        image: userRole.role.image

    }));

    const { password, google_id, ...userData } = updatedUser;

    return {
        ...userData,
        image: userData.image ? `http://${process.env.HOST}:${process.env.PORT}${userData.image}` : null,
        roles: formattedRoles
     }
};


export const createUserService = async (data: createUserInput) => {
    const { name, lastname, email, phone, password } = data;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            name: name,
            lastname: lastname,
            email: email,
            phone: phone,
            password: hashedPassword,
        }
    });

    return user;
}

export const findByEmail = async (email: string) => {
    return await prisma.user.findUnique({ where: { email } });
}

export const findById = async (id: number) => {
    const user = await prisma.user.findUnique({ where: { id: id } });
    if (!user) {
        throw new AppError("USER_NOT_FOUND", 404);
    }

    const { password, google_id, ...userData } = user;

    return {
        ...userData,
        image: userData.image ? `http://${process.env.HOST}:${process.env.PORT}${userData.image}` : null,
    };
}
// El idioma de la app de esta persona: en él se escriben sus notificaciones y correos
export const updateLanguage = async (id: number, language: Language) => {
    await prisma.user.update({ where: { id }, data: { language } });
    return { language };
}

// Un teléfono tiene un solo token: si otra cuenta lo tenía (cerró sesión y entró otra persona), se le quita
export const saveNotificationToken = async (id: number, token: string | null) => {
    if (token) {
        await prisma.user.updateMany({ where: { notification_token: token, id: { not: id } }, data: { notification_token: null } });
    }
    await prisma.user.update({ where: { id }, data: { notification_token: token } });
    return { saved: token !== null };
}

// Idioma guardado de la persona (para textos que arma el backend, como los de Google Maps)
export const getUserLanguage = async (id: number): Promise<Language> => {
    const user = await prisma.user.findUnique({ where: { id }, select: { language: true } });
    return normalizeLanguage(user?.language);
}
