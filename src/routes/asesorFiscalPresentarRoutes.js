/**
 * Presentación telemática AEAT desde el portal asesor.
 * Mount: /asesor/clientes/:empresa_id/fiscal
 *
 * Reutiliza el controller del lado admin pero exige asesorClienteRequired
 * para garantizar que el asesor tiene acceso al cliente.
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import { presentarFiscalModel } from "../controllers/adminFiscalController.js";

const router = Router({ mergeParams: true });

router.use(authRequired, roleRequired("asesor"));

/**
 * @route POST /asesor/clientes/:empresa_id/fiscal/presentar
 * @body { modelo, year, trimestre, certificado_id, opciones? }
 */
router.post("/presentar", asesorClienteRequired("fiscal", "write"), presentarFiscalModel);

export default router;
