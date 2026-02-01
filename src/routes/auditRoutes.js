// backend/src/routes/auditRoutes.js
import express from 'express';
import { authRequired } from '../middlewares/authRequired.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import { 
  getAuditLogs, 
  getFichajesRechazados,
  getAuditStats,
  eliminarFichajeRechazado
} from '../controllers/auditController.js';

const router = express.Router();

// Todas las rutas requieren autenticación y rol admin
router.use(authRequired, roleRequired('admin'));

// Obtener logs de auditoría con filtros
router.get('/logs', getAuditLogs);

// Obtener fichajes rechazados
router.get('/fichajes-rechazados', getFichajesRechazados);

// Obtener estadísticas
router.get('/stats', getAuditStats);

// Eliminar fichaje rechazado permanentemente
router.delete('/fichajes-rechazados/:id', eliminarFichajeRechazado);

export default router;
