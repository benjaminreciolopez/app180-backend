import { Router } from "express";
import { getPartesDia, validarParte } from "../controllers/adminPartesDiaController.js";

const router = Router();

router.get("/partes-dia", getPartesDia);
router.patch("/partes-dia/validar", validarParte);

export default router;
