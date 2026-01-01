import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getCalendarioUsuario,
  getCalendarioEmpresa,
} from "../controllers/calendarioController.js";

export const calendarioRoutes = express.Router();

calendarioRoutes.get("/usuario", authRequired, getCalendarioUsuario);
calendarioRoutes.get("/empresa", authRequired, getCalendarioEmpresa);
