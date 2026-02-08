// backend/src/routes/employeeRoutes.js

import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { requireModule } from "../middlewares/requireModule.js";

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

// Listar empleados (dashboard admin) - Permitir aunque el módulo esté desactivado para planings básicos
router.get("/", getEmployeesAdmin);

// Rutas que SI requieren el módulo de empleados activo (gestión completa)
router.use(requireModule("empleados"));

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
