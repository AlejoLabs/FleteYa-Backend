import type { Request, Response, NextFunction } from "express";
import * as userService from "../services/users.service.js";
import { AppError } from "../utils/App.Error.js";


export const update = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        const data = req.body;
        const file = req.file;
        const user = await userService.update(id, data, file);
        return res.status(201).json(user);
    } catch (err) {
        next(err);    
    }

}

export const createUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const exists = await userService.findByEmail(req.body.email);
        if (exists){
            throw new AppError("El email ya existe", 409);
        }
        const user = await userService.createUserService(req.body);
        return res.status(201).json(user);
    } catch (err) {
        next(err);    
    }
}

export const findById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {id} = req.params;
        const user = await userService.findById(Number(id));
        return res.status(201).json(user);
    } catch (err) {
        next(err);    
    }

}