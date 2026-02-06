import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import * as facturasController from "../controllers/facturasController.js";
import * as conceptosController from "../controllers/conceptosController.js";
import * as ivaController from "../controllers/ivaController.js";
import * as configuracionController from "../controllers/configuracionController.js";
import * as dashboardController from "../controllers/adminDashboardFacturacionController.js";
import * as informesController from "../controllers/adminInformesFacturacionController.js";

const router = Router();

// Todas las rutas requieren autenticación y rol admin
router.use(authRequired, roleRequired("admin"));

/* ================= FACTURAS ================= */

router.get("/facturas", facturasController.listFacturas);
router.get("/facturas/:id", facturasController.getFactura);
router.post("/facturas", facturasController.createFactura);
router.put("/facturas/:id", facturasController.updateFactura);
router.delete("/facturas/:id", facturasController.deleteFactura);

// Acciones sobre facturas
router.post("/facturas/:id/validar", facturasController.validarFactura);
router.post("/facturas/:id/anular", facturasController.anularFactura);
router.get("/facturas/:id/pdf", facturasController.generarPdf); // changed to GET for download
router.post("/facturas/:id/email", facturasController.enviarEmail);

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
router.post("/configuracion/emisor/certificado", configuracionController.uploadCertificado);
router.delete("/configuracion/emisor/certificado", configuracionController.deleteCertificado);

// Sistema
router.get("/configuracion/sistema", configuracionController.getSistemaConfig);
router.put("/configuracion/sistema", configuracionController.updateSistemaConfig);
router.post("/configuracion/generar-texto", configuracionController.generateLegalText);

/* ================= DASHBOARD & INFORMES ================= */

router.get("/dashboard", dashboardController.getDashboardData);

router.get("/informes/iva-trimestral", informesController.getIvaTrimestral);
router.get("/informes/anual", informesController.getFacturacionAnual);
router.get("/informes/ranking-clientes", informesController.getRankingClientes);

export default router;
