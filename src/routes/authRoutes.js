import express from "express";
import {
  register,
  login,
  activateInstall,
  changePassword,
} from "../controllers/authController.js";

import { authRequired } from "../middlewares/authRequired.js";
import { autorizarCambioDispositivo } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall);

// 🔐 CAMBIO DE CONTRASEÑA (empleado / admin logueado)
router.post("/change-password", authRequired, changePassword);
router.post(
  "/authorize-device-change",
  authRequired,
  autorizarCambioDispositivo,
);
export default router;
