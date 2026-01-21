import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";

import { getCalendarioHoyEmpleado } from "../controllers/empleadoCalendarioController.js";
import { getCalendarioIntegradoEmpleado } from "../controllers/empleadoCalendarioIntegradoController.js";

const router = Router();
router.use(authRequired);

// hoy (dashboard)
router.get("/calendario/hoy", getCalendarioHoyEmpleado);

// rango (drawer calendario) -> integrado
router.get("/calendario/usuario", getCalendarioIntegradoEmpleado);

// alias (opcional)
router.get("/calendario/integrado", getCalendarioIntegradoEmpleado);

export default router;
