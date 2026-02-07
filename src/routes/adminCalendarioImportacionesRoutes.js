// backend/src/routes/adminCalendarioImportacionesRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarImportaciones,
  getImportacionDetalle,
  compararImportaciones,
  deshacerImportacion,
} from "../controllers/calendarioImportacionesController.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

const guard = [authRequired, roleRequired("admin"), requireModule("calendario")];

router.get("/calendario/importaciones", ...guard, listarImportaciones);
router.get("/calendario/importaciones/:id", ...guard, getImportacionDetalle);
router.get("/calendario/importaciones-compare", ...guard, compararImportaciones);
router.post("/calendario/importaciones/:id/deshacer", ...guard, deshacerImportacion);

export default router;
