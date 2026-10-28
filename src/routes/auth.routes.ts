import express from "express";
import { validateBody } from "../middlewares/validateBody.js";
import { changePasswordSchema, forgotPasswordSchema, googleLinkSchema, googleLoginSchema, loginSchema, registerDriverSchema, resetPasswordSchema } from "../validators/auth.validator.js";
import { changePassword, forgotPassword, linkGoogle, login, loginWithGoogle, register, registerDriver, resetPassword } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { createUserSchema } from "../validators/user.validator.js";

const router = express.Router();

router.post("/login",validateBody(loginSchema), login);
router.post("/register", validateBody(createUserSchema), register);
router.post("/register-driver", validateBody(registerDriverSchema), registerDriver);
router.post("/forgot-password", validateBody(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validateBody(resetPasswordSchema), resetPassword);
router.post("/google", validateBody(googleLoginSchema), loginWithGoogle);
router.post("/google/link", validateBody(googleLinkSchema), linkGoogle);
router.put("/password", authMiddleware, validateBody(changePasswordSchema), changePassword);

export default router;
