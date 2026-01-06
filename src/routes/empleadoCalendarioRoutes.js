import { Router } from "express";
import { authRequired } from "../middleware/authMiddleware.js";

import {
  getCalendarioHoyEmpleado,
  getCalendarioEmpleadoRango,
} from "../controllers/empleadoCalendarioController.js";

const router = Router();

// 🔐 todas requieren login
router.use(authRequired);

// 📅 hoy (bloquea fichaje si procede)
router.get("/calendario/hoy", getCalendarioHoyEmpleado);

// 📅 rango (vista mensual)
router.get("/calendario", getCalendarioEmpleadoRango);

export default router;
