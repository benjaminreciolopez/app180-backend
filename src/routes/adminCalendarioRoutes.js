// backend/src/routes/adminCalendarioRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { actualizarEstadoAusencia } from "../controllers/ausenciasController.js";
import { requireModule } from "../middlewares/requireModule.js";

import { getCalendarioIntegradoAdmin } from "../controllers/adminCalendarioIntegradoController.js";

const router = Router();

router.use(authRequired);
router.use(roleRequired("admin"));

// requireModule applied per-route to avoid blocking all /admin/* routes
const calendarioGuard = requireModule("calendario");

router.patch("/ausencias/:id/estado", calendarioGuard, actualizarEstadoAusencia);

router.get("/calendario/integrado", calendarioGuard, getCalendarioIntegradoAdmin);

export default router;
