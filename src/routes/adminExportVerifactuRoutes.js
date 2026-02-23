import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  descargarRegistros,
  obtenerInformeCumplimiento
} from '../controllers/exportVerifactuController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(authRequired, roleRequired('admin'));

// GET - Descargar todos los registros VeriFactu en ZIP
// Query params: incluir_eventos (true/false), desde (ISO date), hasta (ISO date)
router.get('/exportar', descargarRegistros);

// GET - Informe de cumplimiento completo
router.get('/informe-cumplimiento', obtenerInformeCumplimiento);

export default router;
