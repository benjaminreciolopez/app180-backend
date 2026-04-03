/**
 * Rutas de titulares para admin (gestiona titulares de su propia empresa)
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getTitulares,
  createTitular,
  updateTitular,
  deleteTitular,
} from "../controllers/titularesController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// empresa_id viene del token del usuario (req.user.empresa_id)
router.get("/titulares", getTitulares);
router.post("/titulares", createTitular);
router.put("/titulares/:id", updateTitular);
router.delete("/titulares/:id", deleteTitular);

export default router;
