// backend/src/routes/adminConsultaRoutes.js
// Rutas para consulta AEAT y gestión de discrepancias (contexto admin)

import { Router } from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  consultarModelo,
  consultarDatosFiscalesHandler,
  consultarCensoHandler,
  getHistorial,
  getConsultaDetalle,
  resolverDiscrepancia,
  getResumenEjercicio,
} from '../controllers/aeatConsultaController.js';

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired('admin'));

/**
 * @route POST /admin/fiscal/consulta/consultar
 * @desc Consultar AEAT para un modelo+periodo y detectar discrepancias
 * @body { modelo, ejercicio, periodo, certificado_id? }
 */
router.post('/consultar', consultarModelo);

/**
 * @route POST /admin/fiscal/consulta/datos-fiscales
 * @desc Consultar datos fiscales del contribuyente en AEAT
 * @body { ejercicio, certificado_id? }
 */
router.post('/datos-fiscales', consultarDatosFiscalesHandler);

/**
 * @route POST /admin/fiscal/consulta/censo
 * @desc Consultar censo del contribuyente en AEAT
 * @body { certificado_id? }
 */
router.post('/censo', consultarCensoHandler);

/**
 * @route GET /admin/fiscal/consulta/historial
 * @desc Listar consultas previas con filtros
 * @query { modelo?, ejercicio?, estado?, limit? }
 */
router.get('/historial', getHistorial);

/**
 * @route GET /admin/fiscal/consulta/resumen/:ejercicio
 * @desc Resumen de estado consultas/discrepancias de un ejercicio
 */
router.get('/resumen/:ejercicio', getResumenEjercicio);

/**
 * @route GET /admin/fiscal/consulta/:consultaId
 * @desc Detalle de una consulta con sus discrepancias
 */
router.get('/:consultaId', getConsultaDetalle);

/**
 * @route POST /admin/fiscal/consulta/:consultaId/resolver
 * @desc Resolver discrepancia (actualizar app o ignorar)
 * @body { discrepancia_id, accion: 'actualizar_app'|'ignorar', notas? }
 */
router.post('/:consultaId/resolver', resolverDiscrepancia);

export default router;
