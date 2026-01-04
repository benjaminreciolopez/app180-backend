import { Router } from "express";
import {
  getTurnos,
  getTurno,
  createTurno,
  updateTurno,
  deleteTurno,
} from "../controllers/turnosController.js";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";

const router = Router();

// 🔐 Todas las rutas protegidas (admin)
router.use(authRequired, roleRequired("admin"));

// GET turnos empresa
router.get("/", getTurnos);

// GET turno por id
router.get("/detalle/:id", getTurno);

// Crear turno
router.post("/", createTurno);

// Editar turno
router.put("/:id", updateTurno);

// Borrar turno
router.delete("/:id", deleteTurno);

export default router;
