// src/routes/adminAdjuntosRoutes.js
import { Router } from "express";
import {
  listarAdjuntosAdmin,
  descargarAdjunto,
  borrarAdjunto,
} from "../controllers/ausenciasAdjuntosController.js";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

const router = Router();

// Listar adjuntos de una ausencia (admin)
router.get(
  "/ausencias/:id/adjuntos",
  authRequired,
  roleRequired("admin"),
  listarAdjuntosAdmin
);

// Descargar (admin)
router.get(
  "/adjuntos/:adjuntoId/download",
  authRequired,
  roleRequired("admin"),
  descargarAdjunto
);

// Borrar (admin)
router.delete(
  "/adjuntos/:adjuntoId",
  authRequired,
  roleRequired("admin"),
  borrarAdjunto
);

export default router;
