import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  crearPago,
  listarPagosCliente,
  listarTodosLosPagos,
  getPendientesParaPago,
  imputarPago,
} from "../controllers/paymentsController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/payments", listarTodosLosPagos);
router.post("/payments", crearPago);
router.get("/clientes/:clienteId/payments", listarPagosCliente);

router.get("/payments/:paymentId/pendientes", getPendientesParaPago);
router.post("/payments/:paymentId/imputar", imputarPago);

export default router;
