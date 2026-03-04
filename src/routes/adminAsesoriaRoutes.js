// backend/src/routes/adminAsesoriaRoutes.js
// Lado cliente - Sección "Mi Asesoría" dentro del admin
import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getMensajes, enviarMensaje, marcarLeido, getNoLeidos, enviarMensajeConAdjunto } from "../controllers/asesoriaMensajesController.js";
import {
  invitarAsesoriaDesdeCliente,
  aceptarVinculo,
  rechazarVinculo,
  revocarAcceso,
  actualizarPermisos,
  getVinculoActual,
} from "../controllers/asesoriaInvitacionController.js";
import { exportTrimestral } from "../controllers/asesoriaExportController.js";
import {
  getMisDocumentosAsesoria,
  uploadDocumentoCliente,
  downloadDocumentoCliente,
  deleteDocumentoCliente,
} from "../controllers/asesorDocumentosController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
router.post("/mensajes/con-adjunto", upload.single("file"), enviarMensajeConAdjunto);
router.get("/mensajes/no-leidos", getNoLeidos);
router.put("/mensajes/:id/leido", marcarLeido);

// Exportaciones para asesoría
router.get("/export/trimestral", exportTrimestral);

// Documentos compartidos con asesor
router.get("/documentos", getMisDocumentosAsesoria);
router.post("/documentos/upload", upload.single("file"), uploadDocumentoCliente);
router.get("/documentos/:id/download", downloadDocumentoCliente);
router.delete("/documentos/:id", deleteDocumentoCliente);

export default router;
