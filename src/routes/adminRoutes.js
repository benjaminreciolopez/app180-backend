import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getAdminDashboard } from "../controllers/adminDashboardController.js";

const router = express.Router();

// ✅ PROTECCIÓN CORRECTA POR RUTA
router.get(
  "/dashboard",
  authRequired,
  roleRequired("admin"),
  getAdminDashboard,
);

export default router;
