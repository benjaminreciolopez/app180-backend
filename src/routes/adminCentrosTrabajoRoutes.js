// backend/src/routes/adminCentrosTrabajoRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarCentros,
  getCentroDetalle,
  crearCentro,
  actualizarCentro,
  desactivarCentro,
  asignarCentroEmpleado,
  desasignarCentroEmpleado,
  listarEmpleadosCentro,
} from "../controllers/centrosTrabajoController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// CRUD
router.get("/centros-trabajo", listarCentros);
router.post("/centros-trabajo", crearCentro);
router.get("/centros-trabajo/:id", getCentroDetalle);
router.get("/centros-trabajo/:id/empleados", listarEmpleadosCentro);
router.put("/centros-trabajo/:id", actualizarCentro);
router.delete("/centros-trabajo/:id", desactivarCentro);

// Asignación
router.post("/centros-trabajo/asignar", asignarCentroEmpleado);
router.post("/centros-trabajo/desasignar", desasignarCentroEmpleado);

export default router;
