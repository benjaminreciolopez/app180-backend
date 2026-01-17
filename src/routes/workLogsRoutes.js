// src/routes/workLogsRoutes.js
import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  crearWorkLog,
  misWorkLogs,
  adminWorkLogs,
  adminWorkLogsResumen,
} from "../controllers/workLogsController.js";

const router = Router();

// empleado
router.post("/", authRequired, crearWorkLog);
router.get("/mis", authRequired, misWorkLogs);

// admin
router.get("/admin", authRequired, roleRequired("admin"), adminWorkLogs);
router.get(
  "/admin/resumen",
  authRequired,
  roleRequired("admin"),
  adminWorkLogsResumen
);

export default router;
