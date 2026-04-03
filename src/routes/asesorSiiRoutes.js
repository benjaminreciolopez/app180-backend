/**
 * Rutas SII (Suministro Inmediato de Informacion) para el asesor
 * Todas bajo /asesor/clientes/:empresa_id/sii
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
  getSiiConfig,
  updateSiiConfig,
  getSiiEnvios,
  getEnvioDetalle,
  prepararEnvio,
  simularEnvio,
  getEstadisticasSii,
} from "../controllers/siiController.js";

const router = Router({ mergeParams: true });

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Config
router.get("/config", asesorClienteRequired("fiscal", "read"), getSiiConfig);
router.put("/config", asesorClienteRequired("fiscal", "write"), updateSiiConfig);

// Envios
router.get("/envios", asesorClienteRequired("fiscal", "read"), getSiiEnvios);
router.get("/envios/:id", asesorClienteRequired("fiscal", "read"), getEnvioDetalle);

// Actions
router.post("/preparar", asesorClienteRequired("fiscal", "write"), prepararEnvio);
router.post("/simular", asesorClienteRequired("fiscal", "write"), simularEnvio);

// Stats
router.get("/estadisticas", asesorClienteRequired("fiscal", "read"), getEstadisticasSii);

export default router;
