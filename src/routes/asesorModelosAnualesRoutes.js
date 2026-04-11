/**
 * Rutas Modelos Anuales para el asesor
 * Todas bajo /asesor/clientes/:empresa_id/modelos-anuales
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
    getModelosAnuales,
    getModeloAnualDetalle,
    calcularModeloAnual,
    marcarPresentado
} from "../controllers/modelosAnualesController.js";
import { downloadBOEAnual } from "../controllers/adminFiscalController.js";

const router = Router({ mergeParams: true });

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

/**
 * @route GET /asesor/clientes/:empresa_id/modelos-anuales/:ejercicio
 * @desc Listar todos los modelos anuales para un ejercicio
 */
router.get("/:ejercicio", asesorClienteRequired("fiscal", "read"), getModelosAnuales);

/**
 * @route GET /asesor/clientes/:empresa_id/modelos-anuales/:ejercicio/:modelo
 * @desc Detalle de un modelo anual especifico
 */
router.get("/:ejercicio/:modelo", asesorClienteRequired("fiscal", "read"), getModeloAnualDetalle);

/**
 * @route POST /asesor/clientes/:empresa_id/modelos-anuales/:ejercicio/:modelo/calcular
 * @desc Calcular/recalcular un modelo anual desde datos existentes
 */
router.post("/:ejercicio/:modelo/calcular", asesorClienteRequired("fiscal", "write"), calcularModeloAnual);

/**
 * @route PUT /asesor/clientes/:empresa_id/modelos-anuales/:ejercicio/:modelo/presentar
 * @desc Marcar un modelo anual como presentado
 */
router.put("/:ejercicio/:modelo/presentar", asesorClienteRequired("fiscal", "write"), marcarPresentado);

/**
 * @route GET /asesor/clientes/:empresa_id/modelos-anuales/download-boe-anual
 * @desc Descargar fichero AEAT importable para modelo anual del cliente
 * @query { year, modelo }
 */
router.get("/download-boe-anual", asesorClienteRequired("fiscal", "read"), (req, res, next) => {
    // Inyectar empresa_id del cliente en req.user para reutilizar downloadBOEAnual
    req.user.empresa_id = req.params.empresa_id;
    downloadBOEAnual(req, res, next);
});

export default router;
