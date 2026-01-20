import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  importarPreviewOCR,
  confirmarOCR,
} from "../controllers/calendarioOCRController.js";

const router = Router();
router.use(authRequired, roleRequired("admin"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por imagen
});

router.post(
  "/calendario/ocr/preview",
  upload.array("files", 12), // hasta 12 páginas
  importarPreviewOCR,
);

router.post("/calendario/ocr/confirmar", confirmarOCR);

export default router;
