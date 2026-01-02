import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  crearOActualizarReporte,
  getReporteHoyEmpleado,
  getMisReportes,
  getReportesEmpresa,
  cambiarEstadoReporte,
  getPendingCount,
} from "../controllers/reportController.js";

const router = express.Router();

router.use(authRequired);

// EMPLEADO
router.post("/", roleRequired("empleado"), crearOActualizarReporte);
router.get("/hoy", roleRequired("empleado"), getReporteHoyEmpleado);
router.get("/mis", roleRequired("empleado"), getMisReportes);

// ADMIN
router.get("/", roleRequired("admin"), getReportesEmpresa);
router.patch("/:id/estado", roleRequired("admin"), cambiarEstadoReporte);

router.get("/pending-count", roleRequired("admin"), getPendingCount);
export default router;
