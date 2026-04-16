import express from "express";
import { validateBody } from "../middlewares/validateBody.js";
import { loginSchema } from "../validators/auth.validator.js";
import { login, register } from "../controllers/auth.controller.js";
import { createUserSchema } from "../validators/user.validator.js";

const router = express.Router();

router.post("/login",validateBody(loginSchema), login);
router.post("/register", validateBody(createUserSchema), register);

export default router;