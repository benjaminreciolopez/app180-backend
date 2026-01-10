import { Router } from "express";
import {
  aprobarVacaciones,
  rechazarVacaciones,
  crearBajaMedica,
  listarAusenciasEmpresa,
  crearAusenciaAdmin,
  actualizarEstadoAusencia,
} from "../controllers/ausenciasController.js";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

const router = Router();

router.get(
  "/ausencias",
  authRequired,
  roleRequired("admin"),
  listarAusenciasEmpresa
);
router.post(
  "/ausencias/baja",
  authRequired,
  roleRequired("admin"),
  crearBajaMedica
);
router.post("/ausencias", crearAusenciaAdmin);

router.patch(
  "/ausencias/:id/aprobar",
  authRequired,
  roleRequired("admin"),
  aprobarVacaciones
);
router.patch(
  "/ausencias/:id/rechazar",
  authRequired,
  roleRequired("admin"),
  rechazarVacaciones
);
router.patch("/ausencias/:id/estado", actualizarEstadoAusencia);

export default router;
