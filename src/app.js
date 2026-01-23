// backend/src/app.js

import express from "express";
import cors from "cors";
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
const app = express();

// =========================
// CRON
// =========================
cron.schedule("59 23 * * *", () => ejecutarAutocierre());

// =========================
// MIDDLEWARES
// =========================
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowed = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://app180-frontend.vercel.app",
      ];

      if (allowed.includes(origin) || origin.endsWith(".vercel.app")) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  }),
);

app.use(express.json());

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => res.send("API APP180 funcionando"));

app.use("/auth", authRoutes);

app.use("/employees", authRequired, employeeRoutes);
app.use("/fichajes", authRequired, fichajeRoutes);
app.use("/calendario", authRequired, calendarioRoutes);
app.use("/turnos", turnosRoutes);

app.use("/empleado", empleadoRoutes);
app.use("/empleado", authRequired, empleadoAusenciasRoutes);

app.use("/admin", authRequired, adminRoutes);
app.use("/admin", authRequired, adminAusenciasRoutes);
app.use("/empleado", authRequired, empleadoAdjuntosRoutes);
app.use("/admin", authRequired, adminAdjuntosRoutes);
app.use("/admin", adminJornadasRoutes);
app.use("/admin", adminplantillasRoutes);
app.use("/empleado", empleadoPlanDiaRoutes);
app.use("/worklogs", workLogsRoutes);
app.use("/admin", adminCalendarioRoutes);
app.use("/empleado", empleadoCalendarioRoutes);
app.use("/empleado", empleadoJornadasRoutes);
app.use("/admin", adminEmployeesRoutes);
app.use("/admin", adminCalendarioOCRRoutes);
app.use("/admin", adminCalendarioImportacionesRoutes);
app.use("/admin", adminclientesroutes);

app.use((err, req, res, next) => {
  if (err?.message?.includes("Tipo de archivo no permitido")) {
    return res.status(400).json({ error: "Solo PDF, JPG o PNG" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ error: "Archivo demasiado grande (máx 10MB)" });
  }
  return next(err);
});

// =========================
// START
// =========================
app.listen(config.port, () =>
  console.log(`Servidor iniciado en puerto ${config.port}`),
);
