// backend/src/routes/asesorConsultaRoutes.js
// Rutas para verificación de modelos y gestión de discrepancias (contexto asesor por cliente)

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

const router = Router({ mergeParams: true });

// Todas las rutas requieren asesor
router.use(authRequired, roleRequired('asesor'));

router.post('/consultar', consultarModelo);
router.post('/importar', importarModeloPresentado);
router.get('/historial', getHistorial);
router.get('/resumen/:ejercicio', getResumenEjercicio);
router.get('/:consultaId', getConsultaDetalle);
router.post('/:consultaId/resolver', resolverDiscrepancia);

export default router;
