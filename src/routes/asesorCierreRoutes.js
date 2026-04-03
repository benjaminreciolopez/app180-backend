/**
 * Rutas Cierre de Ejercicio para el asesor
 * Todas bajo /asesor/clientes/:empresa_id/fiscal/cierre
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
    getCierreEjercicio,
    updateCierreChecklist,
    calcularResumen,
    generarAsientoRegularizacion,
    generarAsientoCierre,
    generarAsientoApertura,
    cerrarEjercicio,
    reabrirEjercicio,
    getCierreLog
} from "../controllers/cierreEjercicioController.js";

const router = Router({ mergeParams: true });

// Todas las rutas requieren auth + role asesor + vínculo con cliente
router.use(authRequired, roleRequired("asesor"));

router.get("/:ejercicio", asesorClienteRequired("fiscal", "read"), getCierreEjercicio);
router.put("/:ejercicio/checklist", asesorClienteRequired("fiscal", "write"), updateCierreChecklist);
router.post("/:ejercicio/calcular", asesorClienteRequired("fiscal", "read"), calcularResumen);
router.post("/:ejercicio/asiento-regularizacion", asesorClienteRequired("fiscal", "write"), generarAsientoRegularizacion);
router.post("/:ejercicio/asiento-cierre", asesorClienteRequired("fiscal", "write"), generarAsientoCierre);
router.post("/:ejercicio/asiento-apertura", asesorClienteRequired("fiscal", "write"), generarAsientoApertura);
router.post("/:ejercicio/cerrar", asesorClienteRequired("fiscal", "write"), cerrarEjercicio);
router.post("/:ejercicio/reabrir", asesorClienteRequired("fiscal", "write"), reabrirEjercicio);
router.get("/:ejercicio/log", asesorClienteRequired("fiscal", "read"), getCierreLog);

export default router;
