/**
 * Rutas RETA para el asesor - Gestion base de cotizacion autonomos
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
    getRetaDashboard,
    getEstimacion, generarEstimacion, getHistorico,
    getPerfil, updatePerfil,
    createEvento, deleteEvento,
    getCambiosBase, createCambioBase,
    getSimulacion,
    createPreOnboarding, getPreOnboarding, updatePreOnboarding,
    vincularPreOnboarding, listPreOnboarding,
    getAlertas, marcarAlertaLeida,
    getTramosReferencia,
} from "../controllers/asesorRetaController.js";

const router = Router();

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Dashboard consolidado RETA
router.get("/dashboard", getRetaDashboard);

// Alertas RETA (todas las empresas del asesor)
router.get("/alertas", getAlertas);
router.put("/alertas/:id/leer", marcarAlertaLeida);

// Pre-onboarding (no requiere empresa_id)
router.get("/pre-onboarding", listPreOnboarding);
router.post("/pre-onboarding", createPreOnboarding);
router.get("/pre-onboarding/:id", getPreOnboarding);
router.put("/pre-onboarding/:id", updatePreOnboarding);
router.post("/pre-onboarding/:id/vincular", vincularPreOnboarding);

// Tramos de referencia
router.get("/tramos/:ejercicio", getTramosReferencia);

// Rutas con empresa_id (requieren vinculo activo)
router.get("/clientes/:empresa_id/estimacion", asesorClienteRequired(), getEstimacion);
router.post("/clientes/:empresa_id/estimacion", asesorClienteRequired(), generarEstimacion);
router.get("/clientes/:empresa_id/historico", asesorClienteRequired(), getHistorico);
router.get("/clientes/:empresa_id/perfil", asesorClienteRequired(), getPerfil);
router.put("/clientes/:empresa_id/perfil", asesorClienteRequired(), updatePerfil);
router.post("/clientes/:empresa_id/eventos", asesorClienteRequired(), createEvento);
router.delete("/clientes/:empresa_id/eventos/:id", asesorClienteRequired(), deleteEvento);
router.get("/clientes/:empresa_id/cambios-base", asesorClienteRequired(), getCambiosBase);
router.post("/clientes/:empresa_id/cambios-base", asesorClienteRequired(), createCambioBase);
router.get("/clientes/:empresa_id/simulacion", asesorClienteRequired(), getSimulacion);

export default router;
