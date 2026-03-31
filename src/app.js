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
import { runAsesorDailyAlertScan, runAsesorMonthlyCheck } from "./jobs/asesorAlertScan.js";
import { verifactuEnvioJob } from "./jobs/verifactuEnvioJob.js";
import { ejecutarGastosRecurrentes, detectarGastosRecurrentes } from "./jobs/gastosRecurrentesJob.js";

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
import asesorRoutes from "./routes/asesorRoutes.js";
import asesorNominasRoutes from "./routes/asesorNominasRoutes.js";
import asesorEmpleadosRoutes from "./routes/asesorEmpleadosRoutes.js";
import adminAsesoriaRoutes from "./routes/adminAsesoriaRoutes.js";
import verificacionPublicaRoutes from "./routes/verificacionPublicaRoutes.js";
import kioskRoutes from "./routes/kioskRoutes.js";
import fichajeCorreccionRoutes from "./routes/fichajeCorreccionRoutes.js";
import fichajeIntegridadRoutes from "./routes/fichajeIntegridadRoutes.js";
import adminCentrosTrabajoRoutes from "./routes/adminCentrosTrabajoRoutes.js";
import adminParteConfigRoutes from "./routes/adminParteConfigRoutes.js";
import nominaEntregasRoutes from "./routes/nominaEntregasRoutes.js";
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
app.use("/admin", emailConfigRoutes); // Email configuration routes
app.use("/admin/reportes", adminReportesRoutes);
app.use("/admin/export", exportRoutes);
app.use("/api/admin/reportes", adminReportesRoutes);
app.use("/api/admin/export", exportRoutes);
app.use("/system", systemRoutes);
app.use("/api/admin/facturacion", facturacionRoutes);
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
app.use("/api/admin/purchases", adminPurchasesRoutes);
app.use("/api/admin/fiscal", adminFiscalRoutes);
app.use("/api/admin/fiscal/renta", adminRentaRoutes);
app.use("/api/admin/fiscal/reglas", adminFiscalRulesRoutes);
app.use("/api/admin/nominas", nominasRoutes);
app.use("/api/admin/nominas", nominaEntregasRoutes); // Entregas y firma de nóminas
app.use("/api/admin", subscriptionRoutes); // Suscripciones y planes
app.use("/api/admin/fabricante", fabricanteProtectedRouter); // Modulo fabricante (protegido)
app.use("/admin/sugerencias", authRequired, sugerenciasRoutes); // Sugerencias (usuarios)
app.use("/api/admin/fabricante/sugerencias", sugerenciasFabricanteRouter); // Sugerencias (fabricante)
app.use("/api/admin/contabilidad", adminContabilidadRoutes); // Módulo contabilidad
app.use("/api/admin/gastos-recurrentes", gastosRecurrentesRoutes); // Gastos recurrentes
app.use("/api/admin/fichajes/integridad", fichajeIntegridadRoutes); // Integridad fichajes RD 8/2019
app.use("/api/admin/asesoria", adminAsesoriaRoutes); // Mi Asesoría (lado cliente)
app.use("/api/admin", adminCentrosTrabajoRoutes); // Centros de Trabajo (sedes)
app.use("/admin", adminParteConfigRoutes); // Partes configurables
app.use("/asesor/nominas", asesorNominasRoutes); // Nóminas cross-client asesor
app.use("/asesor/empleados", asesorEmpleadosRoutes); // Empleados cross-client asesor
app.use("/asesor", asesorRoutes); // Portal asesor


// Mantener rutas originales sin /api para compatibilidad con otras partes si es necesario
app.use("/admin/facturacion", facturacionRoutes);
app.use("/admin/verifactu", adminVerifactuAeatRoutes);
app.use("/admin/verifactu", adminEventosVerifactuRoutes);
app.use("/admin/verifactu", adminExportVerifactuRoutes);
app.use("/admin/verifactu", adminFirmaDigitalRoutes);
app.use("/admin/fiscal", adminFiscalRoutes);
app.use("/admin/fiscal/renta", adminRentaRoutes);
app.use("/admin/fiscal/reglas", adminFiscalRulesRoutes);
app.use("/admin/purchases", adminPurchasesRoutes);
app.use("/admin/nominas", nominasRoutes);
app.use("/admin/notificaciones", notificacionesRoutes);
app.use("/empleado/notificaciones", authRequired, notificacionesRoutes); // Empleados ven sus notificaciones
app.use("/admin", aiRoutes);
app.use("/admin", adminKnowledgeRoutes);
app.use("/admin/contabilidad", adminContabilidadRoutes);
app.use("/admin/asesoria", adminAsesoriaRoutes);
app.use("/admin", adminCentrosTrabajoRoutes); // Centros de Trabajo legacy

// =========================
// GLOBAL ERROR HANDLER
// =========================
app.use((err, req, res, _next) => {
  // Multer errors
  if (err?.message?.includes("Tipo de archivo no permitido")) {
    return res.status(400).json({ error: "Solo PDF, JPG o PNG" });
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

// MIGRACIÓN AUTOMÁTICA (Hotfix)
(async () => {
  try {
    const { sql } = await import("./db.js");
    await sql.unsafe(`
        DO $$
        BEGIN
            ALTER TABLE clients_180 DROP CONSTRAINT IF EXISTS clients_geo_policy_check;
            ALTER TABLE clients_180 ADD CONSTRAINT clients_geo_policy_check CHECK (geo_policy IN ('none', 'strict', 'soft', 'info'));
            -- Añadir columna backup_local_path si no existe
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='backup_local_path') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN backup_local_path TEXT;
            END IF;
            -- Añadir columnas de migración si no existen
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='correlativo_inicial') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN correlativo_inicial INTEGER DEFAULT 0;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_pdf') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_pdf TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_legal_aceptado') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_legal_aceptado BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_fecha_aceptacion') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_fecha_aceptacion TIMESTAMP;
            END IF;
            -- Columnas de Auditoría Avanzada
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_serie') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_serie TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_emisor_nif') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_emisor_nif TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_cliente_nif') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_cliente_nif TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_subtotal') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_subtotal NUMERIC(15,2);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_iva') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_iva NUMERIC(15,2);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='configuracionsistema_180' AND column_name='migracion_last_total') THEN
                ALTER TABLE configuracionsistema_180 ADD COLUMN migracion_last_total NUMERIC(15,2);
            END IF;

            -- Tabla de Eventos Veri*Factu
            CREATE TABLE IF NOT EXISTS registroverifactueventos_180 (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                empresa_id UUID NOT NULL,
                user_id UUID,
                tipo_evento VARCHAR(50) NOT NULL,
                descripcion TEXT,
                fecha_evento TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                hash_anterior VARCHAR(300),
                hash_actual VARCHAR(300),
                meta_data JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            -- Habilitar RLS si no está habilitado
            ALTER TABLE registroverifactueventos_180 ENABLE ROW LEVEL SECURITY;
            
            -- Políticas de RLS (usando DO para evitar errores si ya existen)
            DO $policy$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'registroverifactueventos_180' AND policyname = 'rls_verifactueventos_select') THEN
                    CREATE POLICY rls_verifactueventos_select ON registroverifactueventos_180 FOR SELECT USING (empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid()));
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'registroverifactueventos_180' AND policyname = 'rls_verifactueventos_insert') THEN
                    CREATE POLICY rls_verifactueventos_insert ON registroverifactueventos_180 FOR INSERT WITH CHECK (empresa_id = (SELECT empresa_id FROM users_180 WHERE id = auth.uid()));
                END IF;
            END $policy$;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error en migración automática: %', SQLERRM;
        END $$;
    `);
    logger.info("Migraciones automaticas ejecutadas");
  } catch (e) {
    logger.warn("Error en migracion automatica", { error: e.message });
  }
})();

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
