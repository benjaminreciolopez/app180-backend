// backend/src/routes/authRoutes.js

import express from "express";
import {
  register,
  registerFirstAdmin,
  login,
  activateInstall,
  autorizarCambioDispositivo,
  changePassword,
  getMe,
  googleAuth,
  googleCompleteSetup,
  getMeModules,
} from "../controllers/authController.js";

import { authRequired } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall);
router.post("/register-first-admin", registerFirstAdmin);

// Google Auth
router.post("/google", googleAuth);
router.post("/google/complete-setup", authRequired, googleCompleteSetup);

router.get("/me", authRequired, getMe);
router.get("/me/modules", authRequired, getMeModules);

// Cambio de contraseña
router.post("/change-password", authRequired, changePassword);

router.post(
  "/authorize-device-change",
  authRequired,
  autorizarCambioDispositivo,
);

export default router;
