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
} from "../controllers/clientesController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/clientes", listarClientes);
router.post("/clientes", crearCliente);
router.get("/clientes/:id", getClienteDetalle);
router.patch("/clientes/:id", actualizarCliente);
router.delete("/clientes/:id", desactivarCliente);

/* utilidad */
router.post("/clientes/historico", crearClienteHistorico);

export default router;
