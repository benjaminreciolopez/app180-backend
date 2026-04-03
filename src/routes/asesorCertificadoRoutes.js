// backend/src/routes/asesorCertificadoRoutes.js
// Asesor routes for managing client digital certificates

import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import { asesorClienteRequired } from '../middlewares/asesorRequired.js';
import {
  listCertificados,
  uploadCertificado,
  verifyCertificado,
  deleteCertificado,
  getCertificadoLog,
} from '../controllers/certificadoController.js';

const router = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = file.originalname?.toLowerCase();
    if (ext?.endsWith('.p12') || ext?.endsWith('.pfx')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos .p12 o .pfx'));
    }
  },
});

// All routes require asesor auth + active client link
router.use(authRequired, roleRequired('asesor'));

// GET    /asesor/clientes/:empresa_id/certificados
router.get('/', asesorClienteRequired('fiscal', 'read'), listCertificados);

// POST   /asesor/clientes/:empresa_id/certificados
router.post('/', asesorClienteRequired('fiscal', 'write'), upload.single('file'), uploadCertificado);

// POST   /asesor/clientes/:empresa_id/certificados/:id/verificar
router.post('/:id/verificar', asesorClienteRequired('fiscal', 'write'), verifyCertificado);

// DELETE /asesor/clientes/:empresa_id/certificados/:id
router.delete('/:id', asesorClienteRequired('fiscal', 'write'), deleteCertificado);

// GET    /asesor/clientes/:empresa_id/certificados/:id/log
router.get('/:id/log', asesorClienteRequired('fiscal', 'read'), getCertificadoLog);

export default router;
