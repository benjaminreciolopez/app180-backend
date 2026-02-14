import { Router } from "express";
import { getPartesDia, validarParte, validarPartesMasivo } from "../controllers/adminPartesDiaController.js";

const router = Router();

router.get("/partes-dia", getPartesDia);
router.patch("/partes-dia/validar", validarParte);
router.patch("/partes-dia/validar-masivo", validarPartesMasivo);

export default router;
