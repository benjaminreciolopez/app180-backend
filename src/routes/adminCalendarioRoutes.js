import { Router } from "express";
import { authRequired } from "../middleware/authMiddleware.js";
import { roleRequired } from "../middleware/roleRequired.js";

import { getCalendarioAdmin } from "../controllers/adminCalendarioController.js";
import { resolverAusencia } from "../controllers/ausenciasController.js";

const router = Router();

router.use(authRequired);
router.use(roleRequired("admin"));

// 📅 calendario empresa / empleado
router.get("/calendario", getCalendarioAdmin);
router.get(
  "/calendario/eventos",
  authRequired,
  roleRequired("admin"),
  getEventosCalendarioAdmin
);

// ✅ aprobar / rechazar ausencias
router.patch("/ausencias/:id", resolverAusencia);

export default router;
