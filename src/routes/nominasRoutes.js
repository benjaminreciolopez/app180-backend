
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getNominas, createNomina, deleteNomina, ocrNomina, resumenAnual } from "../controllers/nominasController.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/resumen-anual", resumenAnual);
router.get("/", getNominas);
router.post("/ocr", upload.single("file"), ocrNomina);
router.post("/", upload.single("file"), createNomina);
router.delete("/:id", deleteNomina);

export default router;
