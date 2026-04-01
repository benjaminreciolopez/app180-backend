import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  limpiarNotificaciones,
  deleteNotificacion,
  crearNotificacion,
  responderSugerenciaRecurrente
} from "../controllers/notificacionesController.js";

const router = Router();

router.use(authRequired);

router.get("/", getNotificaciones);
router.post("/", crearNotificacion);
router.post("/:id/responder-sugerencia", responderSugerenciaRecurrente);
router.put("/:id/marcar-leida", marcarLeida);
router.put("/marcar-todas-leidas", marcarTodasLeidas);
router.delete("/limpiar", limpiarNotificaciones);
router.delete("/:id", deleteNotificacion);

export default router;
