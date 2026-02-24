// backend/src/routes/asesorRoutes.js
// Portal del asesor - Todas las rutas requieren role='asesor'
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import { getDashboard, getClientes, getClienteResumen } from "../controllers/asesoriaController.js";
import { getMensajes, enviarMensaje, marcarLeido, getNoLeidos } from "../controllers/asesoriaMensajesController.js";
import { invitarClienteDesdeAsesor, registrarAsesoria } from "../controllers/asesoriaInvitacionController.js";
import { exportTrimestral } from "../controllers/asesoriaExportController.js";

const router = Router();

// Registro público de asesoría (no requiere auth)
router.post("/registro", registrarAsesoria);

// Todas las demás rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Dashboard y clientes
router.get("/dashboard", getDashboard);
router.get("/clientes", getClientes);
router.post("/clientes/invitar", invitarClienteDesdeAsesor);

// Rutas con empresa_id específica (requieren vínculo activo)
router.get("/clientes/:empresa_id/resumen", asesorClienteRequired(), getClienteResumen);
router.get("/clientes/:empresa_id/mensajes", asesorClienteRequired(), getMensajes);
router.post("/clientes/:empresa_id/mensajes", asesorClienteRequired(), enviarMensaje);
router.get("/clientes/:empresa_id/mensajes/no-leidos", asesorClienteRequired(), getNoLeidos);
router.put("/clientes/:empresa_id/mensajes/:id/leido", asesorClienteRequired(), marcarLeido);
router.get("/clientes/:empresa_id/export/trimestral", asesorClienteRequired("facturas", "read"), exportTrimestral);

export default router;
