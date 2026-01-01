import { sql } from "../db.js";

export async function crearOActualizarReporte(req, res) {
  try {
    const user = req.user;
    const empleadoId = user.empleado_id;

    if (!empleadoId) {
      return res.status(400).json({ error: "Usuario no es empleado" });
    }

    const { resumen, horas_trabajadas, cliente_id } = req.body;

    if (!resumen || resumen.trim() === "") {
      return res.status(400).json({ error: "El resumen es obligatorio" });
    }

    const empresa = await sql`
      SELECT empresa_id FROM employees_180 WHERE id = ${empleadoId}
    `;

    const empresa_id = empresa[0].empresa_id;

    const rows = await sql`
      INSERT INTO employee_daily_report_180
        (empleado_id, empresa_id, resumen, horas_trabajadas, cliente_id)
      VALUES
        (${empleadoId}, ${empresa_id}, ${resumen}, ${
      horas_trabajadas || null
    }, ${cliente_id || null})
      ON CONFLICT (empleado_id, fecha)
      DO UPDATE SET 
        resumen = EXCLUDED.resumen,
        horas_trabajadas = EXCLUDED.horas_trabajadas,
        cliente_id = EXCLUDED.cliente_id,
        updated_at = now(),
        estado = 'pendiente'
      RETURNING *
    `;

    res.json(rows[0]);
  } catch (err) {
    console.error("Error creando reporte:", err);
    res.status(500).json({ error: "Error creando reporte" });
  }
}

export async function getReporteHoyEmpleado(req, res) {
  try {
    const empleadoId = req.user.empleado_id;

    const rows = await sql`
      SELECT * FROM employee_daily_report_180
      WHERE empleado_id = ${empleadoId}
      AND fecha = CURRENT_DATE
      LIMIT 1
    `;

    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo reporte" });
  }
}

export async function getMisReportes(req, res) {
  try {
    const empleadoId = req.user.empleado_id;

    const rows = await sql`
      SELECT *
      FROM employee_daily_report_180
      WHERE empleado_id = ${empleadoId}
      ORDER BY fecha DESC
    `;

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo reportes" });
  }
}

export async function getReportesEmpresa(req, res) {
  try {
    const empresaId = await obtenerEmpresa(req.user.id);
    const { estado } = req.query;

    let query = sql`
      SELECT r.*, e.nombre as empleado_nombre
      FROM employee_daily_report_180 r
      JOIN employees_180 e ON e.id = r.empleado_id
      WHERE r.empresa_id = ${empresaId}
    `;

    if (estado && ["pendiente", "aprobado", "rechazado"].includes(estado)) {
      query = sql`
        ${query}
        AND r.estado = ${estado}
      `;
    }

    query = sql`${query} ORDER BY fecha DESC`;

    const rows = await query;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo reportes" });
  }
}

export async function getPendingCount(req, res) {
  try {
    const empresaId = await obtenerEmpresa(req.user.id);

    const rows = await sql`
      SELECT count(*)::int AS total
      FROM employee_daily_report_180
      WHERE empresa_id = ${empresaId}
      AND estado = 'pendiente'
    `;

    res.json({ total: rows[0]?.total ?? 0 });
  } catch (err) {
    console.error("Error obteniendo contador de pendientes:", err);
    res.status(500).json({ error: "Error obteniendo pendientes" });
  }
}

export async function cambiarEstadoReporte(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!["pendiente", "revisado", "aprobado"].includes(estado)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const rows = await sql`
      UPDATE employee_daily_report_180
      SET estado = ${estado}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cambiando estado" });
  }
}

// Helper
async function obtenerEmpresa(userId) {
  const empresa = await sql`
    SELECT id FROM empresa_180 WHERE user_id = ${userId}
  `;
  if (empresa.length === 0) throw new Error("Empresa no encontrada");
  return empresa[0].id;
}
