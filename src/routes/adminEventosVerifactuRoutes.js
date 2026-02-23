import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  listarEventos,
  obtenerEstadisticas,
  verificarIntegridad
} from '../controllers/eventosVerifactuController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(authRequired, roleRequired('admin'));

// GET - Listar eventos del sistema VeriFactu
router.get('/eventos', listarEventos);

// GET - Estadísticas de eventos
router.get('/eventos/stats', obtenerEstadisticas);

// GET - Verificar integridad de la cadena de eventos
router.get('/eventos/verificar', verificarIntegridad);

export default router;
