import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { requireModule } from "../middlewares/requireModule.js";

import {
  crearWorkLog,
  misWorkLogs,
  adminWorkLogs,
  adminWorkLogsResumen,
} from "../controllers/workLogsController.js";

const router = Router();

/**
 * Si el módulo worklogs está desactivado, nadie debería poder usar worklogs.
 * Ponemos requireModule después de authRequired para garantizar req.user.
 */
router.use(authRequired, requireModule("worklogs"));

// empleado
router.post("/", crearWorkLog);
router.get("/mis", misWorkLogs);

// admin
router.get("/admin", roleRequired("admin"), adminWorkLogs);
router.get("/admin/resumen", roleRequired("admin"), adminWorkLogsResumen);

export default router;
