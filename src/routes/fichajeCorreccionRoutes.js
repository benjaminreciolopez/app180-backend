/**
 * Rutas de correcciones de fichajes - RD 8/2019
 * Empleado: solicitar + consultar correcciones
 * Admin: listar + resolver correcciones
 */

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  solicitarCorreccion,
  misCorrecciones,
  listarCorrecciones,
  resolverCorreccion,
} from "../controllers/fichajeCorreccionController.js";

const router = Router();

router.use(authRequired);

// Empleado routes
router.post("/correcciones", roleRequired("empleado"), solicitarCorreccion);
router.get("/correcciones", roleRequired("empleado"), misCorrecciones);

// Admin routes
router.get("/admin/correcciones", roleRequired("admin"), listarCorrecciones);
router.put("/admin/correcciones/:id", roleRequired("admin"), resolverCorreccion);

export default router;
