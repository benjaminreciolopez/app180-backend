// backend/src/routes/adminAusenciasRoutes.js

import { Router } from "express";
import {
  aprobarVacaciones,
  rechazarVacaciones,
  crearBajaMedica,
  listarAusenciasEmpresa,
  crearAusenciaAdmin,
  actualizarEstadoAusencia,
  listarEventosCalendarioAdmin,
} from "../controllers/ausenciasController.js";

import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

/**
 * Bloquea TODO el módulo ausencias si está desactivado
 */
router.use(authRequired, requireModule("ausencias"), roleRequired("admin"));

router.get("/ausencias", listarAusenciasEmpresa);

router.get("/calendario/eventos", listarEventosCalendarioAdmin);

router.post("/ausencias/baja", crearBajaMedica);

router.post("/ausencias", crearAusenciaAdmin);

router.patch("/ausencias/:id/aprobar", aprobarVacaciones);

router.patch("/ausencias/:id/rechazar", rechazarVacaciones);

router.patch("/ausencias/:id/estado", actualizarEstadoAusencia);

export default router;
