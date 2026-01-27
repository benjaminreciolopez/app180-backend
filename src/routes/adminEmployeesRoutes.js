// backend/src/routes/adminEmployeesRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { inviteEmpleado, sendInviteEmail } from "../controllers/authController.js";
import { updateEmployee } from "../controllers/employeeController.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

// Generar invitación / reenviar / autorizar cambio
router.post(
  "/employees/:id/invite",
  authRequired,
  requireModule("empleados"),
  roleRequired("admin"),
  inviteEmpleado,
);

// Enviar email de invitación (opcional)
router.post(
  "/employees/:id/send-invite-email",
  authRequired,
  requireModule("empleados"),
  roleRequired("admin"),
  sendInviteEmail,
);

// Actualizar empleado (nombre, cliente defecto)
router.put(
  "/employees/:id",
  authRequired,
  requireModule("empleados"),
  roleRequired("admin"),
  updateEmployee
);

export default router;
