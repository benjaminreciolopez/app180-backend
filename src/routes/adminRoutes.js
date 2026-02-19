import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getAdminDashboard, getBeneficioReal } from "../controllers/adminDashboardController.js";

const router = express.Router();

// ✅ PROTECCIÓN CORRECTA POR RUTA
router.get(
  "/dashboard",
  authRequired,
  roleRequired("admin"),
  getAdminDashboard,
);

router.get(
  "/dashboard/beneficio",
  authRequired,
  roleRequired("admin"),
  getBeneficioReal,
);

export default router;
