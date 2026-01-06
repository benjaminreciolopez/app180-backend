import { Router } from "express";
import { solicitarAusencia } from "../controllers/ausenciasController.js";
import { authRequired } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/ausencias", authRequired, solicitarAusencia);

export default router;
