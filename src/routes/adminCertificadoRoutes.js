// backend/src/routes/adminCertificadoRoutes.js
// Admin routes for digital certificate management

import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../middlewares/authMiddleware.js';
import { roleRequired } from '../middlewares/roleRequired.js';
import {
  listCertificados,
  uploadCertificado,
  verifyCertificado,
  deleteCertificado,
  getCertificadoLog,
  checkExpiraciones,
} from '../controllers/certificadoController.js';

const router = Router();
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

// All routes require admin auth
router.use(authRequired, roleRequired('admin'));

// GET    /admin/certificados             - List certificates
router.get('/certificados', listCertificados);

// POST   /admin/certificados             - Upload certificate
router.post('/certificados', upload.single('file'), uploadCertificado);

// POST   /admin/certificados/:id/verificar - Verify certificate
router.post('/certificados/:id/verificar', verifyCertificado);

// DELETE /admin/certificados/:id          - Soft delete
router.delete('/certificados/:id', deleteCertificado);

// GET    /admin/certificados/:id/log      - Usage log
router.get('/certificados/:id/log', getCertificadoLog);

// GET    /admin/certificados/expiraciones - Expiring certs
router.get('/certificados/expiraciones', checkExpiraciones);

export default router;
