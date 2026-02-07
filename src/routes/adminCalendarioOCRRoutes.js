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

const guard = [authRequired, roleRequired("admin"), requireModule("calendario")];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post("/calendario/ocr/preview", ...guard, upload.array("files", 12), importarPreviewOCR);
router.post("/calendario/ocr/reparse", ...guard, reparseOCR);
router.post("/calendario/ocr/confirmar", ...guard, confirmarOCR);

export default router;
