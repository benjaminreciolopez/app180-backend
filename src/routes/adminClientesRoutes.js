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
} from "../controllers/clientesController.js";

import {
  listarTarifasCliente,
  crearTarifaCliente,
  cerrarTarifa,
} from "../controllers/clientTariffsController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

/* ================= CLIENTES ================= */

router.get("/clientes", listarClientes);
router.post("/clientes", crearCliente);
router.get("/clientes/next-code", getNextCodigoCliente);

/* TARIFAS (ANTES del :id) */
router.get("/clientes/:id/tarifas", listarTarifasCliente);
router.post("/clientes/:id/tarifas", crearTarifaCliente);
router.delete("/clientes/tarifas/:tarifaId", cerrarTarifa);

/* Cliente individual */
router.get("/clientes/:id", getClienteDetalle);
router.patch("/clientes/:id", actualizarCliente);
router.delete("/clientes/:id", desactivarCliente);

/* Utilidad */
router.post("/clientes/historico", crearClienteHistorico);

export default router;
