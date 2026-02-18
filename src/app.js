// backend/src/app.js

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { config } from "./config.js";

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
import adminStorageRoutes from "./routes/adminStorageRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import adminBackupRoutes from "./routes/adminBackupRoutes.js";
import adminKnowledgeRoutes from "./routes/adminKnowledgeRoutes.js";
import calendarConfigRoutes from "./routes/calendarConfigRoutes.js";
import calendarSyncRoutes from "./routes/calendarSyncRoutes.js";
import calendarWebhookRoutes from "./routes/calendarWebhookRoutes.js";
import adminPartesDiaRoutes from "./routes/adminPartesDiaRoutes.js";
import adminPurchasesRoutes from "./routes/adminPurchasesRoutes.js";

const app = express();

// Render usa proxy inverso → necesario para express-rate-limit
app.set('trust proxy', 1);

// =========================
// CRON
// =========================
cron.schedule("59 23 * * *", () => ejecutarAutocierre()); // Autocierre diario
cron.schedule("0 3 * * *", () => renewCalendarWebhooks()); // Renovar webhooks diario a las 3 AM

// =========================
// MIDDLEWARES
// =========================
app.use((req, res, next) => {
  console.log(`📡 REQUEST: ${req.method} ${req.url}`);
  next();
});

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
      ];

      if (allowed.includes(origin) || origin.endsWith(".vercel.app") || origin.includes("localhost")) {
        return callback(null, true);
      }

      console.warn(`[CORS] Intento bloqueado: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    optionsSuccessStatus: 204
  }),
);


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

app.use("/auth", authLimiter, authRoutes);

app.use("/employees", authRequired, employeeRoutes);
app.use("/fichajes", authRequired, fichajeRoutes);
app.use("/calendario", authRequired, calendarioRoutes);
app.use("/turnos", turnosRoutes);

app.use("/empleado", empleadoRoutes);
app.use("/empleado", authRequired, empleadoAusenciasRoutes);

app.use("/admin", authRequired, adminRoutes);
app.use("/admin/ausencias", authRequired, adminAusenciasRoutes);
app.use("/empleado", authRequired, empleadoAdjuntosRoutes);
app.use("/admin", authRequired, adminAdjuntosRoutes);
app.use("/admin", adminJornadasRoutes);
app.use("/admin", adminplantillasRoutes);
app.use("/", adminJornadasRoutes); // Para compatibilidad con llamadas sin prefix /admin
app.use("/", adminplantillasRoutes); // Para compatibilidad con llamadas sin prefix /admin
app.use("/empleado", empleadoPlanDiaRoutes);
app.use("/worklogs", workLogsRoutes);
app.use("/admin", adminConfigRoutes); // Must be before routes with requireModule
app.use("/admin", adminCalendarioRoutes);
app.use("/empleado", empleadoCalendarioRoutes);
app.use("/empleado", empleadoJornadasRoutes);
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
app.use("/system", systemRoutes);
app.use("/admin/facturacion", facturacionRoutes);
app.use("/admin/storage", adminStorageRoutes);
app.use("/admin", aiRoutes);
app.use("/admin/backup", adminBackupRoutes);
app.use("/admin", adminKnowledgeRoutes);
app.use("/admin", calendarConfigRoutes); // Google Calendar configuration
app.use("/admin", calendarSyncRoutes); // Google Calendar sync
app.use("/api", calendarWebhookRoutes); // Google Calendar webhooks (public)
app.use("/admin", authRequired, adminPartesDiaRoutes);
app.use("/admin", adminPurchasesRoutes);

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
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.message || err);
  }

  res.status(status).json({ error: message });
});

// Catch unhandled rejections
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
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
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error en migración automática: %', SQLERRM;
        END $$;
    `);
    console.log("✅ Migraciones automáticas (geo_policy, backup_path) ejecutadas en DB");
  } catch (e) {
    console.error("⚠️ Error en migración automática geo_policy:", e.message);
  }
})();

app.listen(config.port, () =>
  console.log(`Servidor iniciado en puerto ${config.port}`),
);
