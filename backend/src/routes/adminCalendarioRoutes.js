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
router.use(requireModule("calendario"));

router.patch("/ausencias/:id/estado", actualizarEstadoAusencia);

router.get("/calendario/integrado", getCalendarioIntegradoAdmin);

export default router;
