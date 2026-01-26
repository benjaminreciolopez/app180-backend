import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { sql } from "../db.js";
import { activateInstall } from "../controllers/authController.js";
import { getPlanDiaEmpleado } from "../controllers/planDiaController.js";
import { fixWorkLogValues } from "../controllers/workLogsController.js";
import { listarClientes } from "../controllers/clientesController.js";

const router = Router();

// ==========================
// ACTIVACIÓN INSTALACIÓN PWA
// ==========================
router.post("/activate-install", activateInstall);

//Admin helper
router.get("/fix-values", authRequired, roleRequired("admin"), fixWorkLogValues);

// ==========================
// DASHBOARD EMPLEADO
// ==========================
router.get(
  "/dashboard",
  authRequired,
  roleRequired("empleado"),
  async (req, res) => {
    const empleadoId = req.user.empleado_id;

    const empleado = (
      await sql`
        SELECT e.id, e.nombre, t.nombre AS turno_nombre
        FROM employees_180 e
        LEFT JOIN turnos_180 t ON t.id = e.turno_id
        WHERE e.id = ${empleadoId}
      `
    )[0];

    const fichaje = (
      await sql`
        SELECT *
        FROM fichajes_180
        WHERE empleado_id = ${empleadoId}
        ORDER BY created_at DESC
        LIMIT 1
      `
    )[0];

    res.json({
      nombre: empleado?.nombre,
      turno: empleado?.turno_nombre ? { nombre: empleado.turno_nombre } : null,
      fichando: fichaje?.estado === "ENTRADA",
    });
  }
);

router.get(
  "/plan-dia",
  authRequired,
  roleRequired("empleado"),
  getPlanDiaEmpleado
);

// NUEVO: Clientes para empleado (dropdown trabajos)
router.get("/clientes", authRequired, roleRequired("empleado"), listarClientes);

export default router;
