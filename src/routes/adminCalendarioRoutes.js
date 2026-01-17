import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { actualizarEstadoAusencia } from "../controllers/ausenciasController.js";

import {
  getCalendarioAdmin,
  getEventosCalendarioAdmin,
} from "../controllers/adminCalendarioController.js";
import { importarFestivosNager } from "../controllers/adminCalendarioController.js";
import { getCalendarioIntegradoAdmin } from "../controllers/adminCalendarioIntegradoController.js";

const router = Router();

router.use(authRequired);
router.use(roleRequired("admin"));

// 📅 calendario empresa / empleado
router.get("/calendario", getCalendarioAdmin);
router.get("/calendario/eventos", getEventosCalendarioAdmin);

router.patch("/ausencias/:id/estado", actualizarEstadoAusencia);

// 📥 importar festivos Nager.Date
router.post("/calendario/importar-festivos/:year", importarFestivosNager);

router.get("/calendario/integrado", getCalendarioIntegradoAdmin);

export default router;
