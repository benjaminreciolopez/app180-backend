import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { sql } from "../db.js";

const router = Router();

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

export default router;
