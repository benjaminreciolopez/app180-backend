import { Router } from "express";
import { authRequired } from "../middleware/authMiddleware.js";

import {
  getCalendarioHoyEmpleado,
  getCalendarioEmpleadoRango,
} from "../controllers/empleadoCalendarioController.js";

const router = Router();

router.use(authRequired);

// hoy
router.get("/calendario/hoy", getCalendarioHoyEmpleado);

// rango (drawer calendario)
router.get("/calendario/usuario", getCalendarioEmpleadoRango);

export default router;
