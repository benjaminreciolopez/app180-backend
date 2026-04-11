// backend/src/routes/adminConsultaRoutes.js
// Rutas para verificación de modelos presentados y gestión de discrepancias (contexto admin)

import { Router } from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  consultarModelo,
  getHistorial,
  getConsultaDetalle,
  resolverDiscrepancia,
  getResumenEjercicio,
  importarModeloPresentado,
} from '../controllers/aeatConsultaController.js';

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired('admin'));

/**
 * @route POST /admin/fiscal/consulta/consultar
 * @desc Verificar modelo presentado vs datos actuales
 * @body { modelo, ejercicio, periodo }
 */
router.post('/consultar', consultarModelo);

/**
 * @route POST /admin/fiscal/consulta/importar
 * @desc Importar fichero de modelo presentado (.ses, .190, .180, .347)
 * @body { modelo, ejercicio, periodo?, contenido_fichero }
 */
router.post('/importar', importarModeloPresentado);

/**
 * @route GET /admin/fiscal/consulta/historial
 * @desc Listar verificaciones previas con filtros
 * @query { modelo?, ejercicio?, estado?, limit? }
 */
router.get('/historial', getHistorial);

/**
 * @route GET /admin/fiscal/consulta/resumen/:ejercicio
 * @desc Resumen de estado verificaciones de un ejercicio
 */
router.get('/resumen/:ejercicio', getResumenEjercicio);

/**
 * @route GET /admin/fiscal/consulta/:consultaId
 * @desc Detalle de una verificación con sus discrepancias
 */
router.get('/:consultaId', getConsultaDetalle);

/**
 * @route POST /admin/fiscal/consulta/:consultaId/resolver
 * @desc Resolver discrepancia (actualizar app o ignorar)
 * @body { discrepancia_id, accion: 'actualizar_app'|'ignorar', notas? }
 */
router.post('/:consultaId/resolver', resolverDiscrepancia);

export default router;
