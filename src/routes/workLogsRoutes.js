// src/routes/workLogsRoutes.js
import { Router } from "express";
import { authRequired } from "../middleware/authMiddleware.js";
import { roleRequired } from "../middleware/roleRequired.js";
import {
  crearWorkLog,
  misWorkLogs,
  adminWorkLogs,
  adminWorkLogsResumen,
} from "../controllers/workLogsController.js";

const router = Router();

// empleado o admin con empleado_id (autónomo) -> authRequired ya mete req.user
router.post("/worklogs", authRequired, crearWorkLog);
router.get("/worklogs/mis", authRequired, misWorkLogs);

// admin
router.get(
  "/admin/worklogs",
  authRequired,
  roleRequired("admin"),
  adminWorkLogs
);
router.get(
  "/admin/worklogs/resumen",
  authRequired,
  roleRequired("admin"),
  adminWorkLogsResumen
);

export default router;
