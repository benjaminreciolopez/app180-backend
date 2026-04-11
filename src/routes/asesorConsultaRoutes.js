// backend/src/routes/asesorConsultaRoutes.js
// Rutas para consulta AEAT y gestión de discrepancias (contexto asesor por cliente)

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

const router = Router({ mergeParams: true });

// Todas las rutas requieren asesor
router.use(authRequired, roleRequired('asesor'));

/**
 * @route POST /asesor/clientes/:empresa_id/consulta/consultar
 * @desc Consultar AEAT para un modelo+periodo del cliente
 */
router.post('/consultar', consultarModelo);

/**
 * @route POST /asesor/clientes/:empresa_id/consulta/datos-fiscales
 * @desc Consultar datos fiscales del cliente en AEAT
 */
router.post('/datos-fiscales', consultarDatosFiscalesHandler);

/**
 * @route POST /asesor/clientes/:empresa_id/consulta/censo
 * @desc Consultar censo del cliente en AEAT
 */
router.post('/censo', consultarCensoHandler);

/**
 * @route GET /asesor/clientes/:empresa_id/consulta/historial
 * @desc Listar consultas previas del cliente
 */
router.get('/historial', getHistorial);

/**
 * @route GET /asesor/clientes/:empresa_id/consulta/resumen/:ejercicio
 * @desc Resumen de estado consultas/discrepancias del cliente
 */
router.get('/resumen/:ejercicio', getResumenEjercicio);

/**
 * @route GET /asesor/clientes/:empresa_id/consulta/:consultaId
 * @desc Detalle de una consulta del cliente
 */
router.get('/:consultaId', getConsultaDetalle);

/**
 * @route POST /asesor/clientes/:empresa_id/consulta/:consultaId/resolver
 * @desc Resolver discrepancia del cliente
 */
router.post('/:consultaId/resolver', resolverDiscrepancia);

export default router;
