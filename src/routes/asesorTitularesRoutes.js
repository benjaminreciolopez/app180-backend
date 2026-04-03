/**
 * Rutas de titulares para asesor (gestiona titulares de sus clientes)
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
  getTitulares,
  createTitular,
  updateTitular,
  deleteTitular,
} from "../controllers/titularesController.js";

const router = Router();

router.use(authRequired, roleRequired("asesor"));

// empresa_id viene de la URL (req.params.empresa_id)
router.get("/clientes/:empresa_id/titulares", asesorClienteRequired(), getTitulares);
router.post("/clientes/:empresa_id/titulares", asesorClienteRequired(), createTitular);
router.put("/clientes/:empresa_id/titulares/:id", asesorClienteRequired(), updateTitular);
router.delete("/clientes/:empresa_id/titulares/:id", asesorClienteRequired(), deleteTitular);

export default router;
