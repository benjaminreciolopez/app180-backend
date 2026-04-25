
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    getFiscalData,
    getLibroVentas,
    getLibroGastos,
    getLibroNominas,
    downloadBOE,
    getCalendarioFiscal,
    getModelo390,
    getModelo190,
    getModelo180,
    getModelo347,
    downloadBOEAnual
} from "../controllers/adminFiscalController.js";
import {
    getFiscalAlerts,
    simulateFiscalImpact,
    getAlertConfig,
    updateAlertConfig,
    addEpigrafe,
    deleteEpigrafe
} from "../controllers/fiscalAlertController.js";
import {
    getCierreEjercicio,
    updateCierreChecklist,
    calcularResumen,
    generarAsientoRegularizacion,
    generarAsientoCierre,
    generarAsientoAplicacionResultado,
    generarAsientoApertura,
    cerrarEjercicio,
    reabrirEjercicio,
    getCierreLog
} from "../controllers/cierreEjercicioController.js";

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

router.post("/epigrafes", addEpigrafe);
router.delete("/epigrafes/:codigo", deleteEpigrafe);

/**
 * @route GET /admin/fiscal/modelo390
 * @desc Modelo 390 - Resumen anual IVA
 * @query year
 */
router.get("/modelo390", getModelo390);

/**
 * @route GET /admin/fiscal/modelo190
 * @desc Modelo 190 - Resumen anual retenciones
 * @query year
 */
router.get("/modelo190", getModelo190);

/**
 * @route GET /admin/fiscal/modelo180
 * @desc Modelo 180 - Resumen anual arrendamientos
 * @query year
 */
router.get("/modelo180", getModelo180);

/**
 * @route GET /admin/fiscal/modelo347
 * @desc Modelo 347 - Operaciones con terceros >3.005,06 EUR
 * @query year
 */
router.get("/modelo347", getModelo347);

/**
 * @route GET /admin/fiscal/download-boe-anual
 * @desc Descargar fichero BOE para modelos anuales
 * @query year, modelo
 */
router.get("/download-boe-anual", downloadBOEAnual);

/**
 * @route GET /admin/fiscal/calendario/:year
 * @desc Obtener estado del calendario fiscal para un ejercicio
 */
router.get("/calendario/:year", getCalendarioFiscal);

/**
 * Cierre de Ejercicio routes
 */
router.get("/cierre/:ejercicio", getCierreEjercicio);
router.put("/cierre/:ejercicio/checklist", updateCierreChecklist);
router.post("/cierre/:ejercicio/calcular", calcularResumen);
router.post("/cierre/:ejercicio/asiento-regularizacion", generarAsientoRegularizacion);
router.post("/cierre/:ejercicio/asiento-cierre", generarAsientoCierre);
router.post("/cierre/:ejercicio/asiento-aplicacion-resultado", generarAsientoAplicacionResultado);
router.post("/cierre/:ejercicio/asiento-apertura", generarAsientoApertura);
router.post("/cierre/:ejercicio/cerrar", cerrarEjercicio);
router.post("/cierre/:ejercicio/reabrir", reabrirEjercicio);
router.get("/cierre/:ejercicio/log", getCierreLog);

export default router;
