// backend/src/routes/asesorEmpleadosRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getClientesConEmpleados,
  getEmpleados,
  getEmpleadoDetalle,
  updateEmpleado,
  createEmpleado,
  toggleEmpleadoStatus,
} from "../controllers/asesorEmpleadosController.js";

const router = Router();

router.use(authRequired, roleRequired("asesor"));

router.get("/clientes", getClientesConEmpleados);
router.get("/", getEmpleados);
router.post("/", createEmpleado);
router.get("/:id", getEmpleadoDetalle);
router.put("/:id", updateEmpleado);
router.post("/:id/toggle-status", toggleEmpleadoStatus);

export default router;
