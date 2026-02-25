/**
 * Rutas públicas de verificación CSV - RD 8/2019
 * SIN autenticación, con rate limiting.
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verificarCSV } from "../controllers/verificacionPublicaController.js";

const router = Router();

// Rate limiter: 50 verificaciones / 15 min por IP
const verificacionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Demasiadas verificaciones, intente más tarde" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/:csv_code", verificacionLimiter, verificarCSV);

export default router;
