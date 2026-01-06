import express from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getCalendarioUsuario,
  getCalendarioEmpresa,
} from "../controllers/calendarioController.js";

const router = express.Router();

router.get("/usuario", authRequired, getCalendarioUsuario);
router.get("/empresa", authRequired, getCalendarioEmpresa);

export default router;
