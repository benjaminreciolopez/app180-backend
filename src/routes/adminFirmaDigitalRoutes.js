import express from 'express';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  validarCertificadoDigital,
  obtenerInfoCertificado,
  configurarCertificadoFabricante,
  configurarCertificadoAuto,
  obtenerEstadoCertificados
} from '../controllers/firmaDigitalController.js';
import {
  obtenerEstadoRenovacion,
  obtenerInstruccionesRenovacion
} from '../controllers/certificadoRenovacionController.js';

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

// POST - Configurar el MISMO certificado para CLIENTE y FABRICANTE (autónomos)
router.post('/certificado/configurar-auto', configurarCertificadoAuto);

// GET - Estado de renovación de certificados
router.get('/certificado/renovacion/estado', obtenerEstadoRenovacion);

// GET - Instrucciones de renovación paso a paso
router.get('/certificado/renovacion/instrucciones', obtenerInstruccionesRenovacion);

export default router;
