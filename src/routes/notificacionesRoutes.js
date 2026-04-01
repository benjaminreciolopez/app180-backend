import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import {
  getNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  limpiarNotificaciones,
  deleteNotificacion,
  crearNotificacion,
  responderSugerenciaRecurrente,
  responderPagoModelo
} from "../controllers/notificacionesController.js";

const router = Router();

router.use(authRequired);

router.get("/", getNotificaciones);
router.post("/", crearNotificacion);
router.post("/:id/responder-sugerencia", responderSugerenciaRecurrente);
router.post("/:id/responder-pago-modelo", responderPagoModelo);
router.put("/:id/marcar-leida", marcarLeida);
router.put("/marcar-todas-leidas", marcarTodasLeidas);
router.delete("/limpiar", limpiarNotificaciones);
router.delete("/:id", deleteNotificacion);

export default router;
