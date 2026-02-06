// backend/src/routes/empleadoAusenciasRoutes.js

import { Router } from "express";
import {
  solicitarAusencia,
  misAusencias,
} from "../controllers/ausenciasController.js";

import { authRequired } from "../middlewares/authMiddleware.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

/**
 * Bloquea ausencias a empleados si está desactivado
 */
router.use(authRequired, requireModule("ausencias"));

router.post("/ausencias", solicitarAusencia);

router.get("/ausencias/mis", misAusencias);

export default router;
