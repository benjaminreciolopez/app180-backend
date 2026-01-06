// src/controllers/workLogsController.js
import { sql } from "../db.js";

// Helpers
function ymd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /worklogs
 * Crea un trabajo (work log) para el empleado actual.
 * Válido para role "empleado" y para "admin" si tiene empleado_id (autónomo).
 */
export async function crearWorkLog(req, res) {
  try {
    const user = req.user;
    const empresaId = user.empresa_id;
    const empleadoId = user.empleado_id;

    if (!empresaId || !empleadoId) {
      return res.status(403).json({ error: "Sin empresa_id o empleado_id" });
    }

    const {
      client_id,
      work_item_id,
      descripcion,
      fecha, // opcional, YYYY-MM-DD o ISO
      minutos, // opcional (recomendado)
      precio, // opcional (si se calcula/introduce)
    } = req.body;

    if (!descripcion || descripcion.trim().length < 2) {
      return res.status(400).json({ error: "La descripción es obligatoria" });
    }

    // Validar que el empleado pertenece a la empresa del token
    const emp = await sql`
      SELECT id, empresa_id
      FROM employees_180
      WHERE id = ${empleadoId}
      LIMIT 1
    `;
    if (emp.length === 0 || emp[0].empresa_id !== empresaId) {
      return res
        .status(403)
        .json({ error: "Empleado no pertenece a la empresa" });
    }

    // Validar cliente si viene
    if (client_id) {
      const c = await sql`
        SELECT id
        FROM clients_180
        WHERE id = ${client_id}
          AND empresa_id = ${empresaId}
        LIMIT 1
      `;
      if (c.length === 0) {
        return res
          .status(400)
          .json({ error: "Cliente no válido para esta empresa" });
      }
    }

    // Validar work_item si viene (y que sea de la empresa)
    if (work_item_id) {
      const wi = await sql`
        SELECT id
        FROM work_items_180
        WHERE id = ${work_item_id}
          AND (empresa_id = ${empresaId} OR empresa_id IS NULL)
        LIMIT 1
      `;
      if (wi.length === 0) {
        return res.status(400).json({ error: "Trabajo/servicio no válido" });
      }
    }

    const minutosN = minutos == null ? null : parseIntOrNull(minutos);
    if (minutosN != null && (minutosN < 1 || minutosN > 24 * 60)) {
      return res.status(400).json({ error: "Minutos fuera de rango" });
    }

    const fechaFinal = fecha ? new Date(fecha) : new Date();

    const rows = await sql`
      INSERT INTO work_logs_180
        (employee_id, client_id, work_item_id, descripcion, precio, fecha, minutos, created_at)
      VALUES
        (${empleadoId},
         ${client_id || null},
         ${work_item_id || null},
         ${descripcion.trim()},
         ${precio || null},
         ${fechaFinal.toISOString()},
         ${minutosN},
         now())
      RETURNING *
    `;

    return res.json(rows[0]);
  } catch (err) {
    console.error("❌ crearWorkLog:", err);
    return res.status(500).json({ error: "Error creando work log" });
  }
}

/**
 * GET /worklogs/mis?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Lista trabajos del empleado actual.
 */
export async function misWorkLogs(req, res) {
  try {
    const user = req.user;
    const empresaId = user.empresa_id;
    const empleadoId = user.empleado_id;

    if (!empresaId || !empleadoId) {
      return res.status(403).json({ error: "Sin empresa_id o empleado_id" });
    }

    const desde = (req.query.desde || ymd()).toString();
    const hasta = (req.query.hasta || ymd()).toString();

    const rows = await sql`
      SELECT
        w.*,
        c.nombre AS cliente_nombre,
        wi.nombre AS work_item_nombre
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      LEFT JOIN clients_180 c ON c.id = w.client_id
      LEFT JOIN work_items_180 wi ON wi.id = w.work_item_id
      WHERE w.employee_id = ${empleadoId}
        AND e.empresa_id = ${empresaId}
        AND w.fecha::date BETWEEN ${desde}::date AND ${hasta}::date
      ORDER BY w.fecha DESC
      LIMIT 300
    `;

    return res.json(rows);
  } catch (err) {
    console.error("❌ misWorkLogs:", err);
    return res.status(500).json({ error: "Error obteniendo trabajos" });
  }
}

/**
 * GET /admin/worklogs?desde&hasta&empleado_id&cliente_id
 * Lista trabajos de empresa (admin).
 */
export async function adminWorkLogs(req, res) {
  try {
    const user = req.user;
    if (user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });

    const empresaId = user.empresa_id;
    if (!empresaId)
      return res.status(400).json({ error: "Admin sin empresa_id" });

    const desde = (req.query.desde || ymd()).toString();
    const hasta = (req.query.hasta || ymd()).toString();
    const empleadoId = req.query.empleado_id
      ? req.query.empleado_id.toString()
      : null;
    const clienteId = req.query.cliente_id
      ? req.query.cliente_id.toString()
      : null;

    const rows = await sql`
      SELECT
        w.id,
        w.fecha,
        w.minutos,
        w.precio,
        w.descripcion,
        e.id AS empleado_id,
        e.nombre AS empleado_nombre,
        c.id AS cliente_id,
        c.nombre AS cliente_nombre,
        wi.nombre AS work_item_nombre
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      LEFT JOIN clients_180 c ON c.id = w.client_id
      LEFT JOIN work_items_180 wi ON wi.id = w.work_item_id
      WHERE e.empresa_id = ${empresaId}
        AND w.fecha::date BETWEEN ${desde}::date AND ${hasta}::date
        AND (${empleadoId}::uuid IS NULL OR e.id = ${empleadoId}::uuid)
        AND (${clienteId}::uuid IS NULL OR c.id = ${clienteId}::uuid)
      ORDER BY w.fecha DESC
      LIMIT 500
    `;

    return res.json({ desde, hasta, items: rows });
  } catch (err) {
    console.error("❌ adminWorkLogs:", err);
    return res.status(500).json({ error: "Error obteniendo trabajos (admin)" });
  }
}

/**
 * GET /admin/worklogs/resumen?desde&hasta
 * Agregados para presupuestar (minutos por cliente y por empleado).
 */
export async function adminWorkLogsResumen(req, res) {
  try {
    const user = req.user;
    if (user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });

    const empresaId = user.empresa_id;
    if (!empresaId)
      return res.status(400).json({ error: "Admin sin empresa_id" });

    const desde = (req.query.desde || ymd()).toString();
    const hasta = (req.query.hasta || ymd()).toString();

    const porCliente = await sql`
      SELECT
        c.id AS cliente_id,
        c.nombre AS cliente_nombre,
        COALESCE(SUM(w.minutos), 0)::int AS minutos_total,
        COUNT(*)::int AS trabajos
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      LEFT JOIN clients_180 c ON c.id = w.client_id
      WHERE e.empresa_id = ${empresaId}
        AND w.fecha::date BETWEEN ${desde}::date AND ${hasta}::date
      GROUP BY c.id, c.nombre
      ORDER BY minutos_total DESC
      LIMIT 50
    `;

    const porEmpleado = await sql`
      SELECT
        e.id AS empleado_id,
        e.nombre AS empleado_nombre,
        COALESCE(SUM(w.minutos), 0)::int AS minutos_total,
        COUNT(*)::int AS trabajos
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      WHERE e.empresa_id = ${empresaId}
        AND w.fecha::date BETWEEN ${desde}::date AND ${hasta}::date
      GROUP BY e.id, e.nombre
      ORDER BY minutos_total DESC
      LIMIT 50
    `;

    return res.json({ desde, hasta, porCliente, porEmpleado });
  } catch (err) {
    console.error("❌ adminWorkLogsResumen:", err);
    return res.status(500).json({ error: "Error obteniendo resumen" });
  }
}
