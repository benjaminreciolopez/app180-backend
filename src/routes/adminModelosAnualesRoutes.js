/**
 * Rutas Modelos Anuales para el admin (empresa)
 * Todas bajo /api/admin/fiscal/modelos-anuales
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    getModelosAnuales,
    getModeloAnualDetalle,
    calcularModeloAnual,
    marcarPresentado
} from "../controllers/modelosAnualesController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /api/admin/fiscal/modelos-anuales/:ejercicio
 * @desc Listar todos los modelos anuales para un ejercicio
 */
router.get("/:ejercicio", getModelosAnuales);

/**
 * @route GET /api/admin/fiscal/modelos-anuales/:ejercicio/:modelo
 * @desc Detalle de un modelo anual especifico
 */
router.get("/:ejercicio/:modelo", getModeloAnualDetalle);

/**
 * @route POST /api/admin/fiscal/modelos-anuales/:ejercicio/:modelo/calcular
 * @desc Calcular/recalcular un modelo anual desde datos existentes
 */
router.post("/:ejercicio/:modelo/calcular", calcularModeloAnual);

/**
 * @route PUT /api/admin/fiscal/modelos-anuales/:ejercicio/:modelo/presentar
 * @desc Marcar un modelo anual como presentado
 */
router.put("/:ejercicio/:modelo/presentar", marcarPresentado);

export default router;
