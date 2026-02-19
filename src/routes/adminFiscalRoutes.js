
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getFiscalData } from "../controllers/adminFiscalController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /admin/fiscal/models
 * @desc Obtener datos calculados para Modelos 303 y 130
 * @query year, trimestre
 */
router.get("/models", getFiscalData);

export default router;
