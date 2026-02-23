import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  listarRegistros,
  obtenerEstadisticas,
  enviarRegistro,
  enviarPendientes,
  probarConexion,
  reintentarErrores,
  obtenerDetalleRegistro,
  obtenerCumplimiento
} from '../controllers/verifactuAeatController.js';
import { protegerVerifactuProduccion } from '../middlewares/verifactuComplianceMiddleware.js';
import { logEnviosAeat } from '../middlewares/verifactuEventosMiddleware.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(authRequired, roleRequired('admin'));

// GET - Listar registros VeriFactu
router.get('/registros', listarRegistros);

// GET - Estadísticas de envíos
router.get('/stats', obtenerEstadisticas);

// GET - Estado de cumplimiento (CRÍTICO)
router.get('/cumplimiento', obtenerCumplimiento);

// GET - Detalle de un registro
router.get('/registro/:registroId', obtenerDetalleRegistro);

// POST - Probar conexión con AEAT
router.post('/test-conexion', probarConexion);

// POST - Enviar un registro específico (con protección y logging automático)
router.post('/enviar/:registroId', protegerVerifactuProduccion, logEnviosAeat, enviarRegistro);

// POST - Enviar todos los pendientes (con protección y logging automático)
router.post('/enviar-pendientes', protegerVerifactuProduccion, logEnviosAeat, enviarPendientes);

// POST - Reintentar registros con error (con protección y logging automático)
router.post('/reintentar-errores', protegerVerifactuProduccion, logEnviosAeat, reintentarErrores);

export default router;
