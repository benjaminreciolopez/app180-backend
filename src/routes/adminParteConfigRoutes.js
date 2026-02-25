import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarParteConfigs,
  getParteConfig,
  crearParteConfig,
  actualizarParteConfig,
  borrarParteConfig,
  asignarEmpleados,
} from "../controllers/parteConfiguracionesController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/parte-configuraciones", listarParteConfigs);
router.get("/parte-configuraciones/:id", getParteConfig);
router.post("/parte-configuraciones", crearParteConfig);
router.put("/parte-configuraciones/:id", actualizarParteConfig);
router.delete("/parte-configuraciones/:id", borrarParteConfig);
router.put("/parte-configuraciones/:id/asignar", asignarEmpleados);

export default router;
