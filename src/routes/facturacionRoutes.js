import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import * as facturasController from "../controllers/facturasController.js";
import * as conceptosController from "../controllers/conceptosController.js";
import * as ivaController from "../controllers/ivaController.js";
import * as configuracionController from "../controllers/configuracionController.js";

const router = Router();

// Todas las rutas requieren autenticación y rol admin
router.use(authRequired, roleRequired("admin"));

/* ================= FACTURAS ================= */

router.get("/facturas", facturasController.listFacturas);
router.get("/facturas/:id", facturasController.getFacturaDetalle);
router.post("/facturas", facturasController.createFactura);
router.put("/facturas/:id", facturasController.updateFactura);
router.delete("/facturas/:id", facturasController.deleteFactura);

// Acciones sobre facturas
router.post("/facturas/:id/validar", facturasController.validarFactura);
router.post("/facturas/:id/anular", facturasController.anularFactura);
router.post("/facturas/:id/pdf", facturasController.generarPDF);
router.post("/facturas/:id/email", facturasController.enviarEmail);
router.get("/facturas/:id/pdf/download", facturasController.descargarPDF);

/* ================= CONCEPTOS ================= */

router.get("/conceptos", conceptosController.listConceptos);
router.get("/conceptos/autocomplete", conceptosController.autocompleteConceptos);
router.post("/conceptos", conceptosController.createConcepto);
router.put("/conceptos/:id", conceptosController.updateConcepto);
router.delete("/conceptos/:id", conceptosController.deleteConcepto);

/* ================= IVA ================= */

router.get("/iva", ivaController.listIVA);
router.post("/iva", ivaController.createIVA);
router.put("/iva/:id", ivaController.updateIVA);
router.delete("/iva/:id", ivaController.deleteIVA);

/* ================= CONFIGURACIÓN ================= */

// Emisor
router.get("/configuracion/emisor", configuracionController.getEmisorConfig);
router.put("/configuracion/emisor", configuracionController.updateEmisorConfig);
router.post("/configuracion/emisor/logo", configuracionController.uploadLogo);

// Sistema
router.get("/configuracion/sistema", configuracionController.getSistemaConfig);
router.put("/configuracion/sistema", configuracionController.updateSistemaConfig);

export default router;
