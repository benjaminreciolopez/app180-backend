import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { securityAlert } from "../middlewares/securityAlert.js";

import {
  getEmpresaConfig,
  updateEmpresaConfig,
  getDashboardWidgets,
  updateDashboardWidgets,
  updateTipoContribuyente,
} from "../controllers/empresaConfigController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/configuracion", getEmpresaConfig);
router.put("/configuracion", securityAlert("config_change"), updateEmpresaConfig);
router.get("/configuracion/widgets", getDashboardWidgets);
router.put("/configuracion/widgets", updateDashboardWidgets);
router.put("/empresa/tipo-contribuyente", updateTipoContribuyente);

export default router;
