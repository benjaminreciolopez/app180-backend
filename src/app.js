// backend/src/app.js

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cron from "node-cron";
import { config } from "./config.js";
import logger from "./utils/logger.js";

import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import fichajeRoutes from "./routes/fichajeRoutes.js";
import calendarioRoutes from "./routes/calendarioRoutes.js";
import turnosRoutes from "./routes/turnosRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import empleadoRoutes from "./routes/empleadoRoutes.js";

import empleadoAusenciasRoutes from "./routes/empleadoAusenciasRoutes.js";
import adminAusenciasRoutes from "./routes/adminAusenciasRoutes.js";

import { authRequired } from "./middlewares/authRequired.js";
import { ejecutarAutocierre } from "./jobs/autocierre.js";
import { renewCalendarWebhooks } from "./jobs/renewCalendarWebhooks.js";
import { verificarCertificadosJob } from "./jobs/verificarCertificados.js";
import { runFiscalAlertScan } from "./jobs/fiscalAlertScan.js";
import { generarAlertasPagoModelos } from "./jobs/fiscalPaymentAlertJob.js";
import { runAsesorDailyAlertScan, runAsesorMonthlyCheck } from "./jobs/asesorAlertScan.js";
import { verifactuEnvioJob } from "./jobs/verifactuEnvioJob.js";
import { ejecutarGastosRecurrentes, detectarGastosRecurrentes } from "./jobs/gastosRecurrentesJob.js";
import { ejecutarFacturasRecurrentes } from "./jobs/facturaRecurrenteJob.js";

import empleadoAdjuntosRoutes from "./routes/empleadoAdjuntosRoutes.js";
import adminAdjuntosRoutes from "./routes/adminAdjuntosRoutes.js";
import adminJornadasRoutes from "./routes/adminJornadasRoutes.js";
import adminplantillasRoutes from "./routes/adminPlantillasRoutes.js";
import empleadoPlanDiaRoutes from "./routes/empleadoPlanDiaRoutes.js";
import workLogsRoutes from "./routes/workLogsRoutes.js";
import adminCalendarioRoutes from "./routes/adminCalendarioRoutes.js";
import empleadoCalendarioRoutes from "./routes/empleadoCalendarioRoutes.js";
import empleadoJornadasRoutes from "./routes/empleadoJornadasRoutes.js";
import adminEmployeesRoutes from "./routes/adminEmployeesRoutes.js";
import adminCalendarioOCRRoutes from "./routes/adminCalendarioOCRRoutes.js";
import adminCalendarioImportacionesRoutes from "./routes/adminCalendarioImportacionesRoutes.js";
import adminclientesroutes from "./routes/adminClientesRoutes.js";
import paymentsRoutes from "./routes/paymentsRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import adminConfigRoutes from "./routes/adminConfigRoutes.js";
import adminProfileRoutes from "./routes/adminProfileRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import emailConfigRoutes from "./routes/emailConfigRoutes.js";
import adminReportesRoutes from "./routes/adminReportesRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import { handleGoogleCallback } from "./controllers/emailConfigController.js";
import { handleGoogleCallback as handleCalendarCallback } from "./controllers/calendarConfigController.js";
import { handleUnifiedCallback } from "./controllers/authController.js";
import facturacionRoutes from "./routes/facturacionRoutes.js";
import adminVerifactuAeatRoutes from "./routes/adminVerifactuAeatRoutes.js";
import adminEventosVerifactuRoutes from "./routes/adminEventosVerifactuRoutes.js";
import adminExportVerifactuRoutes from "./routes/adminExportVerifactuRoutes.js";
import adminFirmaDigitalRoutes from "./routes/adminFirmaDigitalRoutes.js";
import adminStorageRoutes from "./routes/adminStorageRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import adminBackupRoutes from "./routes/adminBackupRoutes.js";
import adminKnowledgeRoutes from "./routes/adminKnowledgeRoutes.js";
import calendarConfigRoutes from "./routes/calendarConfigRoutes.js";
import calendarSyncRoutes from "./routes/calendarSyncRoutes.js";
import calendarWebhookRoutes from "./routes/calendarWebhookRoutes.js";
import adminPartesDiaRoutes from "./routes/adminPartesDiaRoutes.js";
import adminPurchasesRoutes from "./routes/adminPurchasesRoutes.js";
import adminFiscalRoutes from "./routes/adminFiscalRoutes.js";
import adminRentaRoutes from "./routes/adminRentaRoutes.js";
import adminFiscalRulesRoutes from "./routes/adminFiscalRulesRoutes.js";
import nominasRoutes from "./routes/nominasRoutes.js";
import notificacionesRoutes from "./routes/notificacionesRoutes.js";
import { verifactuEventosController } from "./controllers/verifactuEventosController.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import { stripeWebhook } from "./controllers/subscriptionController.js";
import fabricantePublicRoutes, { fabricanteProtectedRouter } from "./routes/fabricanteRoutes.js";
import sugerenciasRoutes, { sugerenciasFabricanteRouter } from "./routes/sugerenciasRoutes.js";
import adminContabilidadRoutes from "./routes/adminContabilidadRoutes.js";
import gastosRecurrentesRoutes from "./routes/gastosRecurrentesRoutes.js";
import facturaRecurrenteRoutes from "./routes/facturaRecurrenteRoutes.js";
import asesorRoutes from "./routes/asesorRoutes.js";
import asesorNominasRoutes from "./routes/asesorNominasRoutes.js";
import asesorEmpleadosRoutes from "./routes/asesorEmpleadosRoutes.js";
import asesorClientesRoutes from "./routes/asesorClientesRoutes.js";
import asesorRetaRoutes from "./routes/asesorRetaRoutes.js";
import asesorCertificadosRoutes from "./routes/asesorCertificadosRoutes.js";
import asesorCertificadoRoutes from "./routes/asesorCertificadoRoutes.js";
import adminCertificadoRoutes from "./routes/adminCertificadoRoutes.js";
import asesorCierreRoutes from "./routes/asesorCierreRoutes.js";
import asesorRentaRoutes from "./routes/asesorRentaRoutes.js";
import asesorLaboralRoutes from "./routes/asesorLaboralRoutes.js";
import asesorSiiRoutes from "./routes/asesorSiiRoutes.js";
import adminRetaAutonomoRoutes from "./routes/adminRetaRoutes.js";
import { runRetaAlertScan, runRetaEstimationScan } from "./services/retaAlertService.js";
import { asesorWriteGuard } from "./middlewares/asesorWriteGuard.js";
import adminAsesoriaRoutes from "./routes/adminAsesoriaRoutes.js";
import adminTitularesRoutes from "./routes/adminTitularesRoutes.js";
import asesorTitularesRoutes from "./routes/asesorTitularesRoutes.js";
import verificacionPublicaRoutes from "./routes/verificacionPublicaRoutes.js";
import kioskRoutes from "./routes/kioskRoutes.js";
import fichajeCorreccionRoutes from "./routes/fichajeCorreccionRoutes.js";
import fichajeIntegridadRoutes from "./routes/fichajeIntegridadRoutes.js";
import adminCentrosTrabajoRoutes from "./routes/adminCentrosTrabajoRoutes.js";
import adminParteConfigRoutes from "./routes/adminParteConfigRoutes.js";
import nominaEntregasRoutes from "./routes/nominaEntregasRoutes.js";
import asesorModelosAnualesRoutes from "./routes/asesorModelosAnualesRoutes.js";
import asesorFiscalPresentarRoutes from "./routes/asesorFiscalPresentarRoutes.js";
import adminInmovilizadoRoutes from "./routes/adminInmovilizadoRoutes.js";
import asesorInmovilizadoRoutes from "./routes/asesorInmovilizadoRoutes.js";
import adminModelosAnualesRoutes from "./routes/adminModelosAnualesRoutes.js";
import adminConsultaRoutes from "./routes/adminConsultaRoutes.js";
import asesorConsultaRoutes from "./routes/asesorConsultaRoutes.js";
import { adminCredencialesRouter } from "./routes/credencialesRoutes.js";
import appConfigRoutes from "./routes/appConfigRoutes.js";
import { miParteConfig } from "./controllers/parteConfiguracionesController.js";

const app = express();

// Render usa proxy inverso → necesario para express-rate-limit
app.set('trust proxy', 1);

// =========================
// CRON
// =========================
cron.schedule("59 23 * * *", () => ejecutarAutocierre()); // Autocierre diario
cron.schedule("0 3 * * *", () => renewCalendarWebhooks()); // Renovar webhooks diario a las 3 AM
cron.schedule("0 9 * * *", () => verificarCertificadosJob()); // Verificar certificados digitales diario a las 9 AM
cron.schedule("0 8 * * 1", () => runFiscalAlertScan()); // Escaneo fiscal semanal lunes 8 AM
cron.schedule("0 9 * * *", () => runAsesorDailyAlertScan()); // Alertas asesor: plazos fiscales + docs nuevos
cron.schedule("0 8 1 * *", () => runAsesorMonthlyCheck()); // Revision mensual: clientes inactivos + alertas
cron.schedule("*/30 * * * *", () => verifactuEnvioJob()); // VeriFactu: reintentar pendientes cada 30 min
cron.schedule("0 7 * * *", () => ejecutarGastosRecurrentes()); // Gastos recurrentes: ejecutar plantillas diariamente a las 7 AM
cron.schedule("0 9 1 * *", () => detectarGastosRecurrentes()); // Gastos recurrentes: detectar patrones el día 1 de cada mes
cron.schedule("0 6 * * *", () => ejecutarFacturasRecurrentes()); // Facturas recurrentes: generar borradores diario a las 6 AM
cron.schedule("0 8 15 1,4,7,10 *", () => generarAlertasPagoModelos()); // Modelos fiscales: alertar pago el 15 de ene/abr/jul/oct
cron.schedule("0 7 1,15 * *", () => runRetaEstimationScan()); // RETA: recalcular estimaciones 1 y 15 de cada mes
cron.schedule("0 8 * * *", () => runRetaAlertScan()); // RETA: alertas diarias a las 8 AM
cron.schedule("0 * * * *", async () => { // Limpiar sesiones QR expiradas cada hora
  try {
    const { sql } = await import("./db.js");
    await sql`UPDATE qr_sessions_180 SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()`;
  } catch (e) { logger.warn("Error limpiando QR sessions", { error: e.message }); }
});

// =========================
// MIDDLEWARES
// =========================
app.use(morgan("short", {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.url === "/" || req.url === "/health",
}));

// =========================
// SECURITY
// =========================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// Rate limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Inténtalo de nuevo en unos minutos." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de acceso. Espera 15 minutos." },
});

const qrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones QR. Espera un momento." },
});

app.use(globalLimiter);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowed = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "https://app180-frontend.vercel.app",
        "https://app180.vercel.app",
        "https://contendo.es",
        "https://www.contendo.es",
      ];

      if (allowed.includes(origin) || origin.endsWith(".vercel.app") || origin.endsWith(".contendo.es") || origin.includes("localhost")) {
        return callback(null, true);
      }

      logger.warn(`CORS bloqueado: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With", "X-Empresa-Id"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    optionsSuccessStatus: 204
  }),
);


// Stripe webhook DEBE ir ANTES de express.json() porque necesita raw body
app.post("/api/webhook/stripe", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Servir archivos estáticos (uploads locales)
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => res.send("API APP180 funcionando"));

// OAuth2 callbacks (must be at root level, PRIOR to other auth routes)
app.get("/auth/google/callback", handleGoogleCallback); // Email (legacy)
app.get("/auth/google/calendar/callback", handleCalendarCallback); // Calendar (legacy)
app.get("/auth/google/unified-callback", handleUnifiedCallback); // Unified setup (Calendar + Gmail)

// Rutas publicas QR fabricante (sin auth, con rate limit)
app.use("/api/public", qrLimiter, fabricantePublicRoutes);

// Verificación pública CSV - RD 8/2019 (sin auth, con rate limit propio)
app.use("/api/verificar", verificacionPublicaRoutes);

// Kiosko de fichaje (auth mixta: admin JWT para gestión + device token para uso)
app.use("/api/kiosk", kioskRoutes);

app.use("/auth", authLimiter, authRoutes);

app.use("/employees", authRequired, employeeRoutes);
app.use("/fichajes", authRequired, fichajeRoutes);
app.use("/fichajes", fichajeCorreccionRoutes); // auth inside router
app.use("/calendario", authRequired, calendarioRoutes);
app.use("/turnos", turnosRoutes);

app.use("/empleado", empleadoRoutes);
app.use("/empleado", authRequired, empleadoAusenciasRoutes);

app.use("/api/admin", authRequired, adminRoutes);
app.use("/admin", authRequired, adminRoutes); // Mantener por compatibilidad legacy
app.use("/admin/ausencias", authRequired, adminAusenciasRoutes);
app.use("/empleado", authRequired, empleadoAdjuntosRoutes);
app.use("/admin", authRequired, adminAdjuntosRoutes);
app.use("/admin", adminJornadasRoutes);
app.use("/admin", adminplantillasRoutes);
app.use("/empleado", empleadoPlanDiaRoutes);
app.use("/worklogs", workLogsRoutes);
app.use("/admin", adminConfigRoutes); // Must be before routes with requireModule
app.use("/admin", adminCalendarioRoutes);
app.use("/empleado", empleadoCalendarioRoutes);
app.use("/empleado", empleadoJornadasRoutes);
app.get("/empleado/mi-parte-config", authRequired, miParteConfig);
app.use("/admin", adminEmployeesRoutes);
app.use("/admin", adminCalendarioOCRRoutes);
app.use("/admin", adminCalendarioImportacionesRoutes);
app.use("/admin", adminclientesroutes);
app.use("/admin", paymentsRoutes);
app.use("/perfil", adminProfileRoutes);
app.use("/admin/auditoria", auditRoutes);
app.use("/admin/credenciales", adminCredencialesRouter);
app.use("/admin/app-config", appConfigRoutes);
app.use("/admin", emailConfigRoutes); // Email configuration routes
app.use("/admin/reportes", adminReportesRoutes);
app.use("/admin/export", exportRoutes);
app.use("/api/admin/reportes", adminReportesRoutes);
app.use("/api/admin/export", exportRoutes);
app.use("/system", systemRoutes);
app.use("/api/admin/facturacion", asesorWriteGuard("facturas"), facturacionRoutes);
app.use("/api/admin/verifactu", adminVerifactuAeatRoutes);
app.use("/api/admin/verifactu", adminEventosVerifactuRoutes);
app.use("/api/admin/verifactu", adminExportVerifactuRoutes);
app.use("/api/admin/verifactu", adminFirmaDigitalRoutes);
app.use("/api/admin/storage", adminStorageRoutes);
app.use("/api/admin", aiRoutes);
app.use("/api/admin/backup", adminBackupRoutes);
app.use("/api/admin", adminKnowledgeRoutes);
app.use("/api/admin", calendarConfigRoutes); // Google Calendar configuration
app.use("/api/admin", calendarSyncRoutes); // Google Calendar sync
app.use("/api", calendarWebhookRoutes); // Google Calendar webhooks (public)
app.use("/api/admin", authRequired, adminPartesDiaRoutes);
app.use("/api/admin/purchases", asesorWriteGuard("gastos"), adminPurchasesRoutes);
app.use("/api/admin/fiscal", asesorWriteGuard("fiscal"), adminFiscalRoutes);
app.use("/api/admin/fiscal/renta", asesorWriteGuard("fiscal"), adminRentaRoutes);
app.use("/api/admin/fiscal/reglas", asesorWriteGuard("fiscal"), adminFiscalRulesRoutes);
app.use("/api/admin/fiscal/modelos-anuales", asesorWriteGuard("fiscal"), adminModelosAnualesRoutes);
app.use("/api/admin/inmovilizado", asesorWriteGuard("fiscal"), adminInmovilizadoRoutes);
app.use("/api/admin/fiscal/consulta", asesorWriteGuard("fiscal"), adminConsultaRoutes);
app.use("/api/admin/nominas", nominasRoutes);
app.use("/api/admin/nominas", nominaEntregasRoutes); // Entregas y firma de nóminas
app.use("/api/admin", subscriptionRoutes); // Suscripciones y planes
app.use("/api/admin/fabricante", fabricanteProtectedRouter); // Modulo fabricante (protegido)
app.use("/admin/sugerencias", authRequired, sugerenciasRoutes); // Sugerencias (usuarios)
app.use("/api/admin/fabricante/sugerencias", sugerenciasFabricanteRouter); // Sugerencias (fabricante)
app.use("/api/admin/contabilidad", asesorWriteGuard("contabilidad"), adminContabilidadRoutes); // Módulo contabilidad
app.use("/api/admin/gastos-recurrentes", gastosRecurrentesRoutes); // Gastos recurrentes
app.use("/api/admin/facturacion/recurrentes", facturaRecurrenteRoutes); // Facturas recurrentes
app.use("/api/admin/fichajes/integridad", fichajeIntegridadRoutes); // Integridad fichajes RD 8/2019
app.use("/api/admin/asesoria", adminAsesoriaRoutes); // Mi Asesoría (lado cliente)
app.use("/api/admin/reta", adminRetaAutonomoRoutes); // RETA: estimacion propia autonomo
app.use("/admin", adminTitularesRoutes); // Titulares/socios empresa (admin) - legacy
app.use("/api/admin", adminTitularesRoutes); // Titulares/socios empresa (admin) - api
app.use("/api/admin", adminCentrosTrabajoRoutes); // Centros de Trabajo (sedes)
app.use("/admin", adminParteConfigRoutes); // Partes configurables
app.use("/asesor/nominas", asesorNominasRoutes); // Nóminas cross-client asesor
app.use("/asesor/empleados", asesorEmpleadosRoutes); // Empleados cross-client asesor
app.use("/asesor/mis-clientes", asesorClientesRoutes); // Clientes propios asesor
app.use("/asesor/reta", asesorRetaRoutes); // RETA: base cotizacion autonomos
app.use("/asesor/certificados", asesorCertificadosRoutes); // Certificados digitales metadata (asesor)
app.use("/asesor/clientes/:empresa_id/certificados", asesorCertificadoRoutes); // Certificados digitales upload real (asesor)
app.use("/api/admin", adminCertificadoRoutes); // Certificados digitales upload real (admin)
app.use("/asesor/clientes/:empresa_id/fiscal/cierre", asesorCierreRoutes); // Cierre ejercicio (asesor)
app.use("/asesor/clientes/:empresa_id/fiscal", asesorFiscalPresentarRoutes); // Presentación AEAT modelos trimestrales (asesor)
app.use("/asesor/clientes/:empresa_id/inmovilizado", asesorInmovilizadoRoutes); // Inmovilizado y amortizaciones (asesor)
app.use("/asesor/clientes/:empresa_id/sii", asesorSiiRoutes); // SII: Suministro Inmediato de Informacion (asesor)
app.use("/asesor/clientes/:empresa_id/modelos-anuales", asesorModelosAnualesRoutes); // Modelos anuales AEAT (asesor)
app.use("/asesor/clientes/:empresa_id/consulta", asesorConsultaRoutes); // Consulta AEAT + discrepancias (asesor)
app.use("/asesor", asesorLaboralRoutes); // Laboral profesional (contratos, bajas, cotizaciones SS)
app.use("/asesor", asesorRentaRoutes); // Renta IRPF + Impuesto Sociedades (asesor)
app.use("/asesor", asesorTitularesRoutes); // Titulares de clientes (asesor) - legacy
app.use("/api/asesor", asesorTitularesRoutes); // Titulares de clientes (asesor) - api
app.use("/asesor", asesorRoutes); // Portal asesor


// Mantener rutas originales sin /api para compatibilidad con otras partes si es necesario
app.use("/admin/facturacion", asesorWriteGuard("facturas"), facturacionRoutes);
app.use("/admin/verifactu", adminVerifactuAeatRoutes);
app.use("/admin/verifactu", adminEventosVerifactuRoutes);
app.use("/admin/verifactu", adminExportVerifactuRoutes);
app.use("/admin/verifactu", adminFirmaDigitalRoutes);
app.use("/admin/fiscal", asesorWriteGuard("fiscal"), adminFiscalRoutes);
app.use("/admin/fiscal/renta", asesorWriteGuard("fiscal"), adminRentaRoutes);
app.use("/admin/fiscal/reglas", asesorWriteGuard("fiscal"), adminFiscalRulesRoutes);
app.use("/admin/fiscal/modelos-anuales", asesorWriteGuard("fiscal"), adminModelosAnualesRoutes);
app.use("/admin/inmovilizado", asesorWriteGuard("fiscal"), adminInmovilizadoRoutes);
app.use("/admin/fiscal/consulta", asesorWriteGuard("fiscal"), adminConsultaRoutes);
app.use("/admin/purchases", asesorWriteGuard("gastos"), adminPurchasesRoutes);
app.use("/admin/nominas", nominasRoutes);
app.use("/admin/notificaciones", notificacionesRoutes);
app.use("/empleado/notificaciones", authRequired, notificacionesRoutes); // Empleados ven sus notificaciones
app.use("/admin", aiRoutes);
app.use("/admin", adminKnowledgeRoutes);
app.use("/admin/contabilidad", asesorWriteGuard("contabilidad"), adminContabilidadRoutes);
app.use("/admin/asesoria", adminAsesoriaRoutes);
app.use("/admin/gastos-recurrentes", gastosRecurrentesRoutes);
app.use("/admin/facturacion/recurrentes", facturaRecurrenteRoutes);
app.use("/admin", adminCentrosTrabajoRoutes); // Centros de Trabajo legacy

// =========================
// GLOBAL ERROR HANDLER
// =========================
app.use((err, req, res, _next) => {
  // Multer errors
  if (err?.message?.includes("Tipo de archivo no permitido")) {
    return res.status(400).json({ error: "Solo PDF, JPG o PNG" });
  }
  if (err?.message?.includes("Solo se aceptan archivos .p12")) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Archivo demasiado grande (máx 10MB)" });
  }

  // CORS errors
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origen no permitido" });
  }

  // Known errors with status
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Error interno del servidor";

  if (status >= 500) {
    logger.error(`${req.method} ${req.url}: ${err.message || err}`, { stack: err.stack });
  }

  res.status(status).json({ error: message });
});

// Catch unhandled rejections
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { message: err.message, stack: err.stack });
  process.exit(1);
});

// =========================
// START
// =========================

// Schema changes are now managed via versioned migrations.
// Run `npm run migrate` after pulling new migrations under backend/migrations/.

// Export app for testing (supertest)
export default app;

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(config.port, () =>
    logger.info(`Servidor iniciado en puerto ${config.port}`),
  );

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    logger.info(`${signal} recibido. Cerrando servidor...`);
    server.close(async () => {
      try {
        const { sql } = await import("./db.js");
        await sql.end({ timeout: 5 });
        logger.info("Conexiones DB cerradas");
      } catch (e) {
        logger.error("Error cerrando DB", { error: e.message });
      }
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forzando cierre tras 10s");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
