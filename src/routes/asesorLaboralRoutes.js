// backend/src/routes/asesorLaboralRoutes.js
// Rutas del modulo Laboral Profesional para el asesor

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
  getContratos,
  createContrato,
  updateContrato,
  extinguirContrato,
  calcularFiniquito,
  getBajas,
  createBaja,
  updateBaja,
  darAltaMedica,
  getCotizaciones,
  calcularCotizacionMensual,
  getDashboardLaboral,
} from "../controllers/laboralController.js";

const router = Router({ mergeParams: true });

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Dashboard laboral cross-client (no requiere empresa_id)
router.get("/laboral/dashboard", getDashboardLaboral);

// --- Contratos ---
router.get(
  "/clientes/:empresa_id/contratos",
  asesorClienteRequired("empleados", "read"),
  getContratos
);
router.post(
  "/clientes/:empresa_id/contratos",
  asesorClienteRequired("empleados", "write"),
  createContrato
);
router.put(
  "/clientes/:empresa_id/contratos/:id",
  asesorClienteRequired("empleados", "write"),
  updateContrato
);
router.post(
  "/clientes/:empresa_id/contratos/:id/extinguir",
  asesorClienteRequired("empleados", "write"),
  extinguirContrato
);
router.post(
  "/clientes/:empresa_id/contratos/:id/finiquito",
  asesorClienteRequired("empleados", "read"),
  calcularFiniquito
);

// --- Bajas laborales ---
router.get(
  "/clientes/:empresa_id/bajas",
  asesorClienteRequired("empleados", "read"),
  getBajas
);
router.post(
  "/clientes/:empresa_id/bajas",
  asesorClienteRequired("empleados", "write"),
  createBaja
);
router.put(
  "/clientes/:empresa_id/bajas/:id",
  asesorClienteRequired("empleados", "write"),
  updateBaja
);
router.post(
  "/clientes/:empresa_id/bajas/:id/alta",
  asesorClienteRequired("empleados", "write"),
  darAltaMedica
);

// --- Cotizaciones SS ---
router.get(
  "/clientes/:empresa_id/cotizaciones/:anio",
  asesorClienteRequired("empleados", "read"),
  getCotizaciones
);
router.post(
  "/clientes/:empresa_id/cotizaciones/:anio/:mes/calcular",
  asesorClienteRequired("empleados", "write"),
  calcularCotizacionMensual
);

export default router;
