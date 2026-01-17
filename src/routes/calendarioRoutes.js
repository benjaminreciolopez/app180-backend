import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getCalendarioUsuarioEventos,
  getDiaUsuarioDetalle,
  getCalendarioEmpresa,
  getEstadoHoyUsuario,
} from "../controllers/calendarioController.js";

const router = express.Router();

// 📅 Calendario visual (eventos ya resueltos)
router.get("/usuario/eventos", getCalendarioUsuarioEventos);

// 📆 Detalle de un día
router.get("/usuario/dia", getDiaUsuarioDetalle);

// 🏢 Vista empresa (admin)
router.get("/empresa", getCalendarioEmpresa);

// 📍 Estado de hoy
router.get("/hoy", getEstadoHoyUsuario);

export default router;
