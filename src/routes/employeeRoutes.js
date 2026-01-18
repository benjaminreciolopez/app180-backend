import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  createEmployee,
  getEmployeesAdmin,
  updateEmployeeStatus,
} from "../controllers/employeeController.js";

import {
  generateEmployeeInvite,
  updateEmployeeDeviceStatus,
} from "../controllers/employeeSecurityController.js";

const router = express.Router();

// 🔐 Todo este router es SOLO ADMIN
router.use(authRequired, roleRequired("admin"));

// ==========================
// EMPLEADOS (ADMIN)
// ==========================

// Listar empleados (dashboard admin)
router.get("/", getEmployeesAdmin);

// Crear empleado
router.post("/", createEmployee);

// Activar / desactivar empleado
router.put("/:id/status", updateEmployeeStatus);

// ==========================
// SEGURIDAD / DISPOSITIVOS
// ==========================

// Generar invitación PWA
router.post("/:id/invite", generateEmployeeInvite);

// Activar / bloquear dispositivo
router.put("/:id/device-status", updateEmployeeDeviceStatus);

export default router;
