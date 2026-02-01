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

router.get("/", listarAusenciasEmpresa);
router.post("/", crearAusenciaAdmin);

router.post("/baja", crearBajaMedica);
router.patch("/:id/aprobar", aprobarVacaciones);

router.get("/calendario/eventos", listarEventosCalendarioAdmin);

router.patch("/ausencias/:id/rechazar", rechazarVacaciones);

router.patch("/ausencias/:id/estado", actualizarEstadoAusencia);

export default router;
