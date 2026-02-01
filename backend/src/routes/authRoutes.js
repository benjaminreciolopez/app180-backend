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
} from "../controllers/authController.js";

import { authRequired } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall);
router.post("/register-first-admin", registerFirstAdmin);

router.get("/me", authRequired, getMe);

// 🔐 CAMBIO DE CONTRASEÑA
router.post("/change-password", authRequired, changePassword);

router.post(
  "/authorize-device-change",
  authRequired,
  autorizarCambioDispositivo,
);

export default router;
