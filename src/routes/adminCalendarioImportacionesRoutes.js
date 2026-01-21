import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarImportaciones,
  getImportacionDetalle,
  compararImportaciones,
  deshacerImportacion,
} from "../controllers/calendarioImportacionesController.js";

const router = Router();
router.use(authRequired, roleRequired("admin"));

router.get("/calendario/importaciones", listarImportaciones);
router.get("/calendario/importaciones/:id", getImportacionDetalle);
router.get("/calendario/importaciones-compare", compararImportaciones);
router.post("/calendario/importaciones/:id/deshacer", deshacerImportacion);

export default router;
