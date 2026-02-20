
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    getFiscalData,
    getLibroVentas,
    getLibroGastos,
    getLibroNominas,
    presentModelo303
} from "../controllers/adminFiscalController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /admin/fiscal/models
 * @desc Obtener datos calculados para Modelos 303 y 130
 * @query year, trimestre
 */
router.get("/models", getFiscalData);

/**
 * @route GET /admin/fiscal/libro-ventas
 * @query year
 */
router.get("/libro-ventas", getLibroVentas);

/**
 * @route GET /admin/fiscal/libro-gastos
 * @query year
 */
router.get("/libro-gastos", getLibroGastos);

/**
 * @route GET /admin/fiscal/libro-nominas
 * @query year
 */
router.get("/libro-nominas", getLibroNominas);

/**
 * @route POST /admin/fiscal/presentar-303
 * @body year, trimestre
 */
router.post("/presentar-303", presentModelo303);

export default router;
