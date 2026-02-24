// backend/src/routes/adminAsesoriaRoutes.js
// Lado cliente - Sección "Mi Asesoría" dentro del admin
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getMensajes, enviarMensaje, marcarLeido, getNoLeidos } from "../controllers/asesoriaMensajesController.js";
import {
  invitarAsesoriaDesdeCliente,
  aceptarVinculo,
  rechazarVinculo,
  revocarAcceso,
  actualizarPermisos,
  getVinculoActual,
} from "../controllers/asesoriaInvitacionController.js";
import { exportTrimestral } from "../controllers/asesoriaExportController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// Vínculo con asesoría
router.get("/vinculo", getVinculoActual);
router.post("/invitar", invitarAsesoriaDesdeCliente);
router.put("/aceptar/:id", aceptarVinculo);
router.put("/rechazar/:id", rechazarVinculo);
router.delete("/revocar", revocarAcceso);
router.put("/permisos", actualizarPermisos);

// Mensajería con asesor
router.get("/mensajes", getMensajes);
router.post("/mensajes", enviarMensaje);
router.get("/mensajes/no-leidos", getNoLeidos);
router.put("/mensajes/:id/leido", marcarLeido);

// Exportaciones para asesoría
router.get("/export/trimestral", exportTrimestral);

export default router;
