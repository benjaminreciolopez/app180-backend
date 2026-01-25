// backend/src/routes/adminEmployeesRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { inviteEmpleado } from "../controllers/authController.js";
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

export default router;
