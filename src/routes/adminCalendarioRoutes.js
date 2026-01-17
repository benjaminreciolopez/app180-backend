import { Router } from "express";
import { authRequired } from "../middleware/authMiddleware.js";
import { roleRequired } from "../middleware/roleRequired.js";

import {
  getCalendarioAdmin,
  getEventosCalendarioAdmin,
} from "../controllers/adminCalendarioController.js";
import { resolverAusencia } from "../controllers/ausenciasController.js";
import { importarFestivosNager } from "../controllers/adminCalendarioController.js";
import { getCalendarioIntegradoAdmin } from "../controllers/adminCalendarioIntegradoController.js";

const router = Router();

router.use(authRequired);
router.use(roleRequired("admin"));

// 📅 calendario empresa / empleado
router.get("/calendario", getCalendarioAdmin);
router.get("/calendario/eventos", getEventosCalendarioAdmin);

// ✅ aprobar / rechazar ausencias
router.patch("/ausencias/:id", resolverAusencia);

// 📥 importar festivos Nager.Date
router.post("/calendario/importar-festivos/:year", importarFestivosNager);

router.get("/calendario/integrado", getCalendarioIntegradoAdmin);

export default router;
