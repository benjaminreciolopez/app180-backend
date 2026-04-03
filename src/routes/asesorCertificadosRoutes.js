/**
 * Rutas Certificados Digitales para el asesor
 * Gestión de certificados .p12/.pfx de clientes
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
  getCertificados,
  createCertificado,
  updateCertificado,
  deleteCertificado,
  getCertificadosProximosCaducar,
  logUsoCertificado,
  getUsoCertificado,
} from "../controllers/certificadosController.js";

const router = Router();

// Todas las rutas requieren auth + role asesor
router.use(authRequired, roleRequired("asesor"));

// Dashboard: certificados proximos a caducar (cross-client)
router.get("/proximos-caducar", getCertificadosProximosCaducar);

// Rutas con empresa_id (requieren vinculo activo)
router.get("/clientes/:empresa_id/certificados", asesorClienteRequired(), getCertificados);
router.post("/clientes/:empresa_id/certificados", asesorClienteRequired(), createCertificado);
router.put("/clientes/:empresa_id/certificados/:id", asesorClienteRequired(), updateCertificado);
router.delete("/clientes/:empresa_id/certificados/:id", asesorClienteRequired(), deleteCertificado);
router.post("/clientes/:empresa_id/certificados/:id/log", asesorClienteRequired(), logUsoCertificado);
router.get("/clientes/:empresa_id/certificados/:id/log", asesorClienteRequired(), getUsoCertificado);

export default router;
