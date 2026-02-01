// src/routes/empleadoAdjuntosRoutes.js
import { Router } from "express";
import multer from "multer";
import path from "path";
import { buildUploadPath } from "../controllers/ausenciasAdjuntosController.js";
import {
  subirAdjuntoEmpleado,
  listarAdjuntosEmpleado,
  descargarAdjunto,
} from "../controllers/ausenciasAdjuntosController.js";
import { authRequired } from "../middlewares/authMiddleware.js";

const router = Router();

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const ausenciaId = req.params.id;
      const dir = buildUploadPath({ req, ausenciaId });
      await (await import("fs/promises")).mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const safe = path
      .basename(file.originalname || "archivo")
      .replace(/[^\w.\-()+\s]/g, "_")
      .slice(0, 150);

    const stamp = Date.now();
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido"));
    }
    cb(null, true);
  },
});

// Subir + listar en una ausencia
router.post(
  "/ausencias/:id/adjuntos",
  authRequired,
  upload.single("file"),
  subirAdjuntoEmpleado
);
router.get("/ausencias/:id/adjuntos", authRequired, listarAdjuntosEmpleado);

// Descargar (empleado)
router.get("/adjuntos/:adjuntoId/download", authRequired, descargarAdjunto);

export default router;
