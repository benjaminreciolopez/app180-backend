
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getNominas,
  createNomina,
  updateNomina,
  deleteNomina,
  ocrNomina,
  resumenAnual,
  resumenEmpresario,
} from "../controllers/nominasController.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/resumen-anual", resumenAnual);
router.get("/resumen-empresario", resumenEmpresario);
router.get("/", getNominas);
router.post("/", upload.single("pdf"), createNomina);
router.post("/ocr", upload.single("pdf"), ocrNomina);
router.put("/:id", updateNomina);
router.delete("/:id", deleteNomina);

export default router;
