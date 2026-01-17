import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getCalendarioUsuario,
  getCalendarioEmpresa,
  getEstadoHoyUsuario,
} from "../controllers/calendarioController.js";

const router = express.Router();

router.get("/usuario", authRequired, getCalendarioUsuario);
router.get("/usuario/eventos", authRequired, getCalendarioUsuarioEventos);
router.get("/usuario/dia", authRequired, getDiaUsuarioDetalle);
router.get("/empresa", authRequired, getCalendarioEmpresa);
router.get("/hoy", authRequired, getEstadoHoyUsuario);

export default router;
