
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    getEjerciciosDisponibles,
    getReglasByEjercicio,
    createRegla,
    updateRegla,
    deleteRegla,
    copiarReglas,
    getPatterns,
    createPattern,
    updatePattern,
    deletePattern,
    resetPatternStats,
    invalidarCache,
    testPattern
} from "../controllers/adminFiscalRulesController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

// ============================================================
// RUTAS ESPECÍFICAS (deben ir ANTES de /:ejercicio y /:id)
// ============================================================

/**
 * @route GET /admin/fiscal/reglas
 * @desc Listar ejercicios disponibles con resumen
 */
router.get("/", getEjerciciosDisponibles);

/**
 * @route POST /admin/fiscal/reglas
 * @desc Crear o actualizar una regla fiscal
 * @body { ejercicio, categoria, clave, valor, descripcion? }
 */
router.post("/", createRegla);

/**
 * @route POST /admin/fiscal/reglas/copiar
 * @desc Copiar reglas de un ejercicio a otro
 * @body { desde: number, hasta: number }
 */
router.post("/copiar", copiarReglas);

/**
 * @route POST /admin/fiscal/reglas/invalidar-cache
 * @desc Invalidar caché de reglas fiscales
 * @body { ejercicio?: number }
 */
router.post("/invalidar-cache", invalidarCache);

/**
 * @route POST /admin/fiscal/reglas/test-pattern
 * @desc Probar un regex pattern contra un texto
 * @body { regex_pattern, texto, grupo_valor? }
 */
router.post("/test-pattern", testPattern);

// ============================================================
// REGEX PATTERNS PARA EXTRACCIÓN DE CASILLAS
// ============================================================

/**
 * @route GET /admin/fiscal/reglas/patterns
 * @desc Listar todos los regex patterns con estadísticas
 */
router.get("/patterns", getPatterns);

/**
 * @route POST /admin/fiscal/reglas/patterns
 * @desc Crear un nuevo regex pattern
 * @body { casilla, regex_pattern, concepto?, seccion?, grupo_valor?, formato_origen?, prioridad? }
 */
router.post("/patterns", createPattern);

/**
 * @route PUT /admin/fiscal/reglas/patterns/:id
 * @desc Actualizar un regex pattern
 */
router.put("/patterns/:id", updatePattern);

/**
 * @route DELETE /admin/fiscal/reglas/patterns/:id
 * @desc Desactivar un regex pattern (soft delete)
 */
router.delete("/patterns/:id", deletePattern);

/**
 * @route POST /admin/fiscal/reglas/patterns/:id/reset-stats
 * @desc Resetear estadísticas de aciertos/fallos
 */
router.post("/patterns/:id/reset-stats", resetPatternStats);

// ============================================================
// RUTAS CON PARÁMETROS DINÁMICOS (al final para evitar conflictos)
// ============================================================

/**
 * @route GET /admin/fiscal/reglas/:ejercicio
 * @desc Listar todas las reglas de un ejercicio
 */
router.get("/:ejercicio", getReglasByEjercicio);

/**
 * @route PUT /admin/fiscal/reglas/:id
 * @desc Actualizar una regla existente
 * @body { valor?, descripcion?, activo? }
 */
router.put("/:id", updateRegla);

/**
 * @route DELETE /admin/fiscal/reglas/:id
 * @desc Desactivar una regla (soft delete)
 */
router.delete("/:id", deleteRegla);

export default router;
