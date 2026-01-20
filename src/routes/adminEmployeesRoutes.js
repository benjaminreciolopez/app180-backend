import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { inviteEmpleado } from "../controllers/authController.js";

const router = Router();

// Generar invitación / reenviar / autorizar cambio
router.post(
  "/employees/:id/invite",
  authRequired,
  roleRequired("admin"),
  inviteEmpleado,
);

export default router;
