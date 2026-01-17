import express from "express";
import {
  getCalendarioUsuarioEventos,
  getDiaUsuarioDetalle,
  getEstadoHoyUsuario,
} from "../controllers/calendarioController.js";

const router = express.Router();

// 📅 Calendario visual (eventos ya resueltos)
router.get("/usuario/eventos", getCalendarioUsuarioEventos);

// 📆 Detalle de un día
router.get("/usuario/dia", getDiaUsuarioDetalle);

// 📍 Estado de hoy
router.get("/hoy", getEstadoHoyUsuario);

export default router;
