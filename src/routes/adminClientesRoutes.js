import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  listarClientes,
  crearCliente,
  actualizarCliente,
  desactivarCliente,
  getClienteDetalle,
  crearClienteHistorico,
  getNextCodigoCliente,
  asignarClienteEmpleado,
  desasignarClienteEmpleado,
  listarAsignacionesClientes,
} from "../controllers/clientesController.js";

import {
  listarTarifasCliente,
  crearTarifaCliente,
  cerrarTarifa,
} from "../controllers/clientTariffsController.js";

import { getBillingStatus, getBillingByClient, getDeudasPendientesConsolidado } from "../controllers/billingController.js";

import {
  listarPagosCliente,
  crearPago,
  getTrabajosPendientes,
} from "../controllers/paymentsController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

/* ================= CLIENTES ================= */

router.get("/billing/clients", getBillingByClient); // Lista global
router.get("/billing/status", getBillingStatus); // Individual
router.get("/billing/deudas-pendientes", getDeudasPendientesConsolidado); // Consolidado (NUEVO)

router.get("/clientes", listarClientes);
router.post("/clientes", crearCliente);
router.get("/clientes/next-code", getNextCodigoCliente);

/* TARIFAS (ANTES del :id) */
router.get("/clientes/:id/tarifas", listarTarifasCliente);
router.post("/clientes/:id/tarifas", crearTarifaCliente);
router.delete("/clientes/tarifas/:tarifaId", cerrarTarifa);

/* PAGOS */
router.get("/clientes/:id/pagos", listarPagosCliente);
router.get("/clientes/:id/trabajos-pendientes", getTrabajosPendientes);
router.post("/pagos", crearPago); // Generic create

/* Cliente individual */
router.get("/clientes/:id", getClienteDetalle);
router.put("/clientes/:id", actualizarCliente);
router.delete("/clientes/:id", desactivarCliente);

/* Utilidad */
router.post("/clientes/historico", crearClienteHistorico);

/* ASIGNACIONES (Desacoplado) */
router.post("/clientes/asignar", asignarClienteEmpleado);
router.post("/clientes/desasignar", desasignarClienteEmpleado);
router.get("/clientes/asignaciones/:empleado_id", listarAsignacionesClientes);

export default router;
