import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  listEmpleadoJornadas,
  getEmpleadoJornadaDetalle,
} from "../controllers/empleadoJornadasController.js";

const router = Router();

router.use(authRequired, roleRequired("empleado"));

// listado + detalle
router.get("/jornadas", listEmpleadoJornadas);
router.get("/jornadas/:id", getEmpleadoJornadaDetalle);

export default router;
