// backend/src/routes/adminCalendarioOCRRoutes.js

import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  importarPreviewOCR,
  reparseOCR,
  confirmarOCR,
} from "../controllers/calendarioOCRController.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = Router();

router.use(
  authRequired,
  roleRequired("admin"),
  requireModule("calendario_import"),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post(
  "/calendario/ocr/preview",
  upload.array("files", 12),
  importarPreviewOCR,
);

// NUEVO: re-analizar texto OCR editado
router.post("/calendario/ocr/reparse", reparseOCR);

router.post("/calendario/ocr/confirmar", confirmarOCR);

export default router;
