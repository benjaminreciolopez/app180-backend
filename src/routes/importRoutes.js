// backend/src/routes/importRoutes.js
//
// Importación masiva CSV. Mount: /api/admin/import
import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { resolveTargetEmpresa } from "../middlewares/resolveTargetEmpresa.js";
import {
  previewClientesCsv,
  confirmClientesCsv,
  previewFacturasCsv,
  confirmFacturasCsv,
  plantillaClientesCsv,
  plantillaFacturasCsv,
  parsearPdfFactura,
} from "../controllers/importController.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(authRequired, roleRequired("admin"), resolveTargetEmpresa());

// Plantillas (sin file upload)
router.get("/clientes/plantilla", plantillaClientesCsv);
router.get("/facturas/plantilla", plantillaFacturasCsv);

// Importación clientes
router.post("/clientes/preview", upload.single("file"), previewClientesCsv);
router.post("/clientes/confirmar", upload.single("file"), confirmClientesCsv);

// Importación facturas
router.post("/facturas/preview", upload.single("file"), previewFacturasCsv);
router.post("/facturas/confirmar", upload.single("file"), confirmFacturasCsv);

// Parser PDF de factura individual (devuelve datos extraídos, no toca BD)
router.post("/facturas/parsear-pdf", upload.single("file"), parsearPdfFactura);

export default router;
