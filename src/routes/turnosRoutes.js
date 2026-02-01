import { Router } from "express";
import { getTurnos, getTurno } from "../controllers/turnosController.js";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";

const router = Router();

// 🔐 Solo admin
router.use(authRequired, roleRequired("admin"));

// 📖 SOLO LECTURA (catálogo interno)
router.get("/", getTurnos);
router.get("/detalle/:id", getTurno);

// ❌ NO crear / editar / borrar desde API pública
router.all("*", (_req, res) =>
  res.status(403).json({
    error: "Los turnos son gestionados automáticamente por el sistema",
  })
);

export default router;
// backend/src/routes/turnosRoutes.js
