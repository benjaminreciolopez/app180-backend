// backend/src/routes/asesorRoutes.js
// Portal del asesor - Todas las rutas requieren role='asesor'
import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import { getDashboard, getClientes, getClienteResumen, getConfiguracion, updateConfiguracion, getDashboardWidgets, updateDashboardWidgets, updateClienteTipoContribuyente, updateClientePermisos, updateModulosMobile } from "../controllers/asesoriaController.js";
import { getMensajes, enviarMensaje, marcarLeido, getNoLeidos, enviarMensajeConAdjunto } from "../controllers/asesoriaMensajesController.js";
import { invitarClienteDesdeAsesor, registrarAsesoria, aceptarVinculoDesdeAsesor, rechazarVinculoDesdeAsesor } from "../controllers/asesoriaInvitacionController.js";
import { exportTrimestral, exportMensual, exportMultiCliente, exportResumenFiscal } from "../controllers/asesoriaExportController.js";
import { getDashboardConsolidado } from "../controllers/asesorDashboardConsolidadoController.js";
import { getNotificacionesAsesor, marcarLeidaAsesor, marcarTodasLeidasAsesor, limpiarNotificacionesAsesor } from "../controllers/asesorNotificacionesController.js";
import { getDocumentosCliente, uploadDocumentoAsesor, downloadDocumento, deleteDocumento } from "../controllers/asesorDocumentosController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Registro público de asesoría (no requiere auth)
router.post("/registro", registrarAsesoria);

// Todas las demás rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Dashboard y clientes
router.get("/dashboard", getDashboard);
router.get("/dashboard/consolidado", getDashboardConsolidado);
router.get("/clientes", getClientes);
router.post("/clientes/invitar", invitarClienteDesdeAsesor);
router.put("/clientes/aceptar/:id", aceptarVinculoDesdeAsesor);
router.put("/clientes/rechazar/:id", rechazarVinculoDesdeAsesor);

// Configuración de la asesoría
router.get("/configuracion", getConfiguracion);
router.put("/configuracion", updateConfiguracion);
router.get("/configuracion/widgets", getDashboardWidgets);
router.put("/configuracion/widgets", updateDashboardWidgets);
router.put("/configuracion/modulos-mobile", updateModulosMobile);

// Notificaciones del asesor
router.get("/notificaciones", getNotificacionesAsesor);
router.put("/notificaciones/:id/marcar-leida", marcarLeidaAsesor);
router.put("/notificaciones/marcar-todas-leidas", marcarTodasLeidasAsesor);
router.delete("/notificaciones/limpiar", limpiarNotificacionesAsesor);

// Export multi-cliente (no requiere empresa_id específica)
router.get("/export/multi-cliente", exportMultiCliente);

// Rutas con empresa_id específica (requieren vínculo activo)
router.put("/clientes/:empresa_id/tipo-contribuyente", asesorClienteRequired(), updateClienteTipoContribuyente);
router.put("/clientes/:empresa_id/permisos", asesorClienteRequired(), updateClientePermisos);
router.get("/clientes/:empresa_id/resumen", asesorClienteRequired(), getClienteResumen);
router.get("/clientes/:empresa_id/mensajes", asesorClienteRequired(), getMensajes);
router.post("/clientes/:empresa_id/mensajes", asesorClienteRequired(), enviarMensaje);
router.post("/clientes/:empresa_id/mensajes/con-adjunto", asesorClienteRequired(), upload.single("file"), enviarMensajeConAdjunto);
router.get("/clientes/:empresa_id/mensajes/no-leidos", asesorClienteRequired(), getNoLeidos);
router.put("/clientes/:empresa_id/mensajes/:id/leido", asesorClienteRequired(), marcarLeido);

// Export por cliente
router.get("/clientes/:empresa_id/export/trimestral", asesorClienteRequired("facturas", "read"), exportTrimestral);
router.get("/clientes/:empresa_id/export/mensual", asesorClienteRequired("facturas", "read"), exportMensual);
router.get("/clientes/:empresa_id/export/resumen-fiscal", asesorClienteRequired("fiscal", "read"), exportResumenFiscal);

// Documentos compartidos
router.get("/clientes/:empresa_id/documentos", asesorClienteRequired(), getDocumentosCliente);
router.post("/clientes/:empresa_id/documentos/upload", asesorClienteRequired(), upload.single("file"), uploadDocumentoAsesor);
router.get("/clientes/:empresa_id/documentos/:id/download", asesorClienteRequired(), downloadDocumento);
router.delete("/clientes/:empresa_id/documentos/:id", asesorClienteRequired(), deleteDocumento);

export default router;
