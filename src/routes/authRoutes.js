import express from "express";
import {
  register,
  registerFirstAdmin,
  login,
  activateInstall,
  autorizarCambioDispositivo,
  changePassword,
} from "../controllers/authController.js";

import { authRequired } from "../middlewares/authRequired.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall);
router.post("/register-first-admin", registerFirstAdmin);

// 🔐 CAMBIO DE CONTRASEÑA (empleado / admin logueado)
router.post("/change-password", authRequired, changePassword);
router.post(
  "/authorize-device-change",
  authRequired,
  autorizarCambioDispositivo,
);
export default router;
