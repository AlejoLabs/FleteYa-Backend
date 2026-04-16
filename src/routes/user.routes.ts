import express from "express";
import { validateBody } from "../middlewares/validateBody.js";
import { createUserSchema, updateUserSchema } from "../validators/user.validator.js";
import { findById, update } from "../controllers/users.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.Middleware.js";



const router = express.Router();
router.get("/:id",authMiddleware, findById);
router.put("/upload/:id", authMiddleware,upload.single("file"),validateBody(updateUserSchema), update);

export default router;