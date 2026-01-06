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

import empleadoAusenciasRoutes from "./routes/empleadoAusencias.routes.js";
import adminAusenciasRoutes from "./routes/adminAusencias.routes.js";

import { authRequired } from "./middlewares/authRequired.js";
import { ejecutarAutocierre } from "./jobs/autocierre.js";

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
  })
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

app.use("/empleado", authRequired, empleadoRoutes);
app.use("/empleado", authRequired, empleadoAusenciasRoutes);

app.use("/admin", authRequired, adminRoutes);
app.use("/admin", authRequired, adminAusenciasRoutes);

// =========================
// START
// =========================
app.listen(config.port, () =>
  console.log(`Servidor iniciado en puerto ${config.port}`)
);
