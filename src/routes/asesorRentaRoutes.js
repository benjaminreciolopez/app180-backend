/**
 * Rutas Renta IRPF + Impuesto de Sociedades (asesor)
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
  getRentaIRPF,
  calcularRentaIRPF,
  updateRentaIRPF,
  marcarRentaPresentada,
  getImpuestoSociedades,
  calcularImpuestoSociedades,
  updateImpuestoSociedades,
  marcarSociedadesPresentado,
  getRentaCampana,
} from "../controllers/rentaSociedadesController.js";

const router = Router();

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// === Campana: vista consolidada de todos los clientes ===
router.get("/fiscal/renta-campana/:ejercicio", getRentaCampana);

// === Renta IRPF (autonomos) ===
router.get("/clientes/:empresa_id/renta/:ejercicio", asesorClienteRequired(), getRentaIRPF);
router.post("/clientes/:empresa_id/renta/:ejercicio/calcular", asesorClienteRequired(), calcularRentaIRPF);
router.put("/clientes/:empresa_id/renta/:ejercicio", asesorClienteRequired(), updateRentaIRPF);
router.put("/clientes/:empresa_id/renta/:ejercicio/presentar", asesorClienteRequired(), marcarRentaPresentada);

// === Impuesto de Sociedades ===
router.get("/clientes/:empresa_id/sociedades/:ejercicio", asesorClienteRequired(), getImpuestoSociedades);
router.post("/clientes/:empresa_id/sociedades/:ejercicio/calcular", asesorClienteRequired(), calcularImpuestoSociedades);
router.put("/clientes/:empresa_id/sociedades/:ejercicio", asesorClienteRequired(), updateImpuestoSociedades);
router.put("/clientes/:empresa_id/sociedades/:ejercicio/presentar", asesorClienteRequired(), marcarSociedadesPresentado);

export default router;
