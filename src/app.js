import express from "express";
import cors from "cors";
import { config } from "./config.js";

import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import fichajeRoutes from "./routes/fichajeRoutes.js";
import cron from "node-cron";
import { ejecutarAutocierre } from "./jobs/autocierre.js";
import { calendarioRoutes } from "./routes/calendarioRoutes.js";
import turnosRoutes from "./routes/turnosRoutes.js";

import { authRequired } from "./middlewares/authRequired.js";
import empleadoRoutes from "./routes/empleadoRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";

const app = express();

cron.schedule("59 23 * * *", () => ejecutarAutocierre());

app.use(
  cors({
    origin: ["https://app180-frontend.vercel.app", "http://localhost:3000"],
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => res.send("API APP180 funcionando"));

app.use("/auth", authRoutes);
app.use("/employees", authRequired, employeeRoutes);
app.use("/fichajes", authRequired, fichajeRoutes);
app.use("/calendario", authRequired, calendarioRoutes);

// 👇 ESTE ES EL QUE NOS IMPORTA
app.use("/turnos", authRequired, turnosRoutes);

// (quita el duplicado)
/// app.use("/fichajes", fichajeRoutes);

app.listen(config.port, () =>
  console.log(`Servidor iniciado en puerto ${config.port}`)
);

app.use("/empleado", empleadoRoutes);

app.use("/reports", reportRoutes);
