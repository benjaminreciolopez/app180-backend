/**
 * Rutas de integridad de fichajes - RD 8/2019
 * Solo admin: verificar cadena, estadísticas, regenerar hashes legacy
 */

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  verificarIntegridad,
  estadisticasIntegridad,
  regenerarHashes,
} from "../controllers/fichajeIntegridadController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/verificar", verificarIntegridad);
router.get("/estadisticas", estadisticasIntegridad);
router.post("/regenerar", regenerarHashes);

export default router;
