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

// ==========================
// NÓMINAS EMPLEADO
// ==========================
router.get(
  "/nominas",
  authRequired,
  roleRequired("empleado"),
  async (req, res) => {
    try {
      const empleadoId = req.user.empleado_id;
      const empresaId = req.user.empresa_id;
      if (!empleadoId) return res.status(400).json({ error: "No eres empleado" });

      const yearRaw = req.query.year || new Date().getFullYear();
      const year = parseInt(yearRaw, 10);

      const nominas = await sql`
        SELECT id, anio, mes, bruto, seguridad_social_empleado, irpf_retencion, liquido, pdf_path, created_at
        FROM nominas_180
        WHERE empresa_id = ${empresaId} AND empleado_id = ${empleadoId} AND anio = ${year}
        ORDER BY mes DESC
      `;

      res.json({ success: true, data: nominas });
    } catch (err) {
      console.error("Error nominas empleado:", err);
      res.status(500).json({ error: "Error obteniendo nóminas" });
    }
  }
);

// ==========================
// NÓMINAS - ENTREGA Y FIRMA
// ==========================
import {
  confirmarRecepcion,
  firmarNomina,
  descargarNominaPDF,
} from "../controllers/nominaEntregasController.js";

router.post("/nominas/:id/confirmar-recepcion", authRequired, roleRequired("empleado"), confirmarRecepcion);
router.post("/nominas/:id/firmar", authRequired, roleRequired("empleado"), firmarNomina);
router.get("/nominas/:id/descargar", authRequired, roleRequired("empleado"), descargarNominaPDF);

export default router;
