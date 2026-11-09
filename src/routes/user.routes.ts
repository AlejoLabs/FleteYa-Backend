import express from "express";
import { validateBody } from "../middlewares/validateBody.js";
import { languageSchema, notificationTokenSchema, updateUserSchema } from "../validators/user.validator.js";
import { findById, saveNotificationToken, update, updateLanguage } from "../controllers/users.controller.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.Middleware.js";
import { requireSelfParam } from "../utils/authorization.js";



const router = express.Router();
router.put("/me/language", authMiddleware, validateBody(languageSchema), updateLanguage);
router.put("/me/notification-token", authMiddleware, validateBody(notificationTokenSchema), saveNotificationToken);
router.get("/:id",authMiddleware, requireSelfParam("id"), findById);
// requireSelfParam va antes de multer: si no es su perfil, la foto ni siquiera se guarda en disco
router.put("/upload/:id", authMiddleware, requireSelfParam("id"), upload.single("file"),validateBody(updateUserSchema), update);

export default router;
