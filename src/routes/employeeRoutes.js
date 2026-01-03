import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  createEmployee,
  getEmployeesAdmin,
  getEmployeesAdmin,
  updateEmployeeStatus,
} from "../controllers/employeeController.js";

import {
  generateEmployeeInvite,
  updateEmployeeDeviceStatus,
} from "../controllers/employeeSecurityController.js";
import { asignarTurnoEmpleado } from "../controllers/turnosController.js";
import { roleRequired } from "../middlewares/roleRequired.js";

const router = express.Router();

router.use(authRequired);

// Empleados (CRUD básico)
router.post("/", createEmployee);
router.get("/", getEmployees);
router.put("/:id/status", updateEmployeeStatus);

// Seguridad de instalación (PWA)
router.post("/:id/invite", generateEmployeeInvite); // genera enlace único
router.put("/:id/device-status", updateEmployeeDeviceStatus); // activar/desactivar PWA empleado
router.put("/:id/turno", asignarTurnoEmpleado);

router.get("/", authRequired, roleRequired("admin"), getEmployeesAdmin);
router.put(
  "/:id/turno",
  authRequired,
  roleRequired("admin"),
  asignarTurnoEmpleado
);

export default router;
