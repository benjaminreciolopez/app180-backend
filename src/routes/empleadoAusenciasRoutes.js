import { Router } from "express";
import {
  solicitarAusencia,
  misAusencias,
} from "../controllers/ausenciasController.js";
import { authRequired } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/ausencias", authRequired, solicitarAusencia);
router.get("/ausencias/mis", authRequired, misAusencias); // 👈 AÑADIR

export default router;
