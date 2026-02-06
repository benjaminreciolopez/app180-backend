// backend/src/routes/empleadoCalendarioRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";

import { getCalendarioHoyEmpleado } from "../controllers/empleadoCalendarioController.js";
import { getCalendarioIntegradoEmpleado } from "../controllers/empleadoCalendarioIntegradoController.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

router.use(authRequired, requireModule("calendario"));

// hoy (dashboard)
router.get("/calendario/hoy", getCalendarioHoyEmpleado);

// rango (drawer calendario) -> integrado
router.get("/calendario/usuario", getCalendarioIntegradoEmpleado);

// alias (opcional)
router.get("/calendario/integrado", getCalendarioIntegradoEmpleado);

export default router;
