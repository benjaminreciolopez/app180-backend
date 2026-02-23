import express from 'express';
import { authRequired, roleRequired } from '../middlewares/authMiddleware.js';
import {
  validarCertificadoDigital,
  obtenerInfoCertificado,
  configurarCertificadoFabricante,
  obtenerEstadoCertificados
} from '../controllers/firmaDigitalController.js';

const router = express.Router();

// Todas las rutas requieren autenticación de admin
router.use(authRequired, roleRequired('admin'));

// GET - Estado de certificados (cliente + fabricante)
router.get('/certificado/estado', obtenerEstadoCertificados);

// POST - Validar certificado (cliente o fabricante)
router.post('/certificado/validar', validarCertificadoDigital);

// POST - Obtener información de certificado
router.post('/certificado/info', obtenerInfoCertificado);

// POST - Configurar certificado del FABRICANTE
router.post('/certificado/fabricante/configurar', configurarCertificadoFabricante);

export default router;
