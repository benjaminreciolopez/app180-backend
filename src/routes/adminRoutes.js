import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getAdminDashboard } from "../controllers/adminDashboardController.js";
import { autorizarCambioDispositivo } from "../controllers/authController.js";

const router = express.Router();

// ✅ PROTECCIÓN CORRECTA POR RUTA
router.get(
  "/dashboard",
  authRequired,
  roleRequired("admin"),
  getAdminDashboard,
  autorizarCambioDispositivo,
);

export default router;
