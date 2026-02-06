import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  getEmpresaConfig,
  updateEmpresaConfig,
  getDashboardWidgets,
  updateDashboardWidgets,
} from "../controllers/empresaConfigController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/configuracion", getEmpresaConfig);
router.put("/configuracion", updateEmpresaConfig);
router.get("/configuracion/widgets", getDashboardWidgets);
router.put("/configuracion/widgets", updateDashboardWidgets);

export default router;
