import prisma from "../database/prismaClient.js";
import bcrypt from "bcryptjs";
import type { createUserInput, updateUserInput } from "../validators/user.validator.js";
import { AppError } from "../utils/App.Error.js";


export const update = async (id: number, data: updateUserInput, file?: Express.Multer.File) => {
    const user = await prisma.user.findUnique({ where: { id: id } });

    if (!user) {
        throw new AppError("Usuario no encontrado", 404);
    }

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

    const { password, ...userData } = updatedUser;

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
        throw new AppError("Usuario no encontrado", 404);
    }

    const { password, ...userData } = user;

    return {
        ...userData,
        image: userData.image ? `http://${process.env.HOST}:${process.env.PORT}${userData.image}` : null,
    };
}