import { Router } from 'express';
import { storageController } from '../controllers/storageController.js';
import { authRequired } from '../middlewares/authRequired.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/files', authRequired, storageController.listFiles);
router.post('/files/upload', authRequired, upload.single('file'), storageController.uploadFile);
router.get('/files/:id/download', authRequired, storageController.downloadFile);
router.delete('/files/:id', authRequired, storageController.deleteFile);

export default router;
