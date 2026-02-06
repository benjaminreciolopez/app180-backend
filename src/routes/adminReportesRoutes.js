import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getReporteRentabilidad } from "../controllers/reporteRentabilidadController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// /admin/reportes/rentabilidad
router.get("/rentabilidad", getReporteRentabilidad);

export default router;
