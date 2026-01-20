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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

router.post(
  "/calendario/ocr/preview",
  upload.single("file"),
  importarPreviewOCR,
);
router.post("/calendario/ocr/confirmar", confirmarOCR);

export default router;
