// backend/src/routes/nominaEntregasRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  enviarNomina,
  enviarNominasLote,
  listarEntregas,
} from "../controllers/nominaEntregasController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

// POST /api/admin/nominas/:id/enviar - Enviar nómina a empleado
router.post("/:id/enviar", enviarNomina);

// POST /api/admin/nominas/enviar-lote - Envío masivo
router.post("/enviar-lote", enviarNominasLote);

// GET /api/admin/nominas/entregas - Estado de entregas
router.get("/entregas", listarEntregas);

export default router;
