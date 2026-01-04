import express from "express";
import {
  register,
  login,
  activateInstall,
  changePassword,
} from "../controllers/authController.js";

import { authRequired } from "../middlewares/authRequired.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall);

// 🔐 CAMBIO DE CONTRASEÑA (empleado / admin logueado)
router.post("/change-password", authRequired, changePassword);

export default router;
