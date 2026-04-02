// backend/src/routes/asesorClientesRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarMisClientes,
  crearCliente,
  actualizarCliente,
  desactivarCliente,
  getClienteDetalle,
  getSiguienteCodigo,
} from "../controllers/asesorClientesController.js";

const router = Router();

router.use(authRequired, roleRequired("asesor"));

router.get("/", listarMisClientes);
router.post("/", crearCliente);
router.get("/next-code", getSiguienteCodigo);
router.get("/:id", getClienteDetalle);
router.put("/:id", actualizarCliente);
router.delete("/:id", desactivarCliente);

export default router;
