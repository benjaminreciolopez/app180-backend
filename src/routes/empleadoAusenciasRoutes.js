// backend/src/routes/empleadoAusenciasRoutes.js

import { Router } from "express";
import {
  solicitarAusencia,
  misAusencias,
} from "../controllers/ausenciasController.js";

import { authRequired } from "../middlewares/authMiddleware.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

// Apply requireModule per-route (NOT router.use) to avoid blocking
// other routers mounted at the same /empleado prefix
router.post("/ausencias", authRequired, requireModule("ausencias"), solicitarAusencia);

router.get("/ausencias/mis", authRequired, requireModule("ausencias"), misAusencias);

export default router;
