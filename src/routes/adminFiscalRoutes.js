
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    getFiscalData,
    getLibroVentas,
    getLibroGastos,
    getLibroNominas,
    downloadBOE
} from "../controllers/adminFiscalController.js";
import {
    getFiscalAlerts,
    simulateFiscalImpact,
    getAlertConfig,
    updateAlertConfig
} from "../controllers/fiscalAlertController.js";

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
 * @route GET /admin/fiscal/download-boe
 * @query year, trimestre, modelo
 */
router.get("/download-boe", downloadBOE);

/**
 * @route GET /admin/fiscal/alerts
 * @desc Obtener alertas fiscales y score de riesgo
 * @query year, trimestre
 */
router.get("/alerts", getFiscalAlerts);

/**
 * @route POST /admin/fiscal/simulate
 * @desc Simular impacto fiscal de una operación hipotética
 * @body { year, trimestre, operation: { type, base_imponible, iva_pct?, iva_importe? } }
 */
router.post("/simulate", simulateFiscalImpact);

/**
 * @route GET /admin/fiscal/alert-config
 * @desc Obtener configuración de alertas fiscales
 */
router.get("/alert-config", getAlertConfig);

/**
 * @route PUT /admin/fiscal/alert-config
 * @desc Actualizar configuración de alertas fiscales
 * @body { sector?, iae_code?, thresholds?, enabled? }
 */
router.put("/alert-config", updateAlertConfig);

export default router;
