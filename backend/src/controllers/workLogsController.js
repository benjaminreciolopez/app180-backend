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
      cliente_id,
      work_item_nombre, 
      descripcion,
      fecha, 
      minutos, 
      precio,
      tipo_facturacion = 'hora', 
      duracion_texto 
    } = req.body;

    console.log("📝 crearWorkLog Payload:", JSON.stringify(req.body));

    if (!descripcion || descripcion.trim().length < 2) {
      console.log("❌ Error description length");
      return res.status(400).json({ error: "La descripción es obligatoria" });
    }

    // Concatenar tipo si existe: "[Tipo] Descripción..."
    let finalDescription = descripcion.trim();
    if (work_item_nombre && work_item_nombre.trim()) {
      finalDescription = `[${work_item_nombre.trim()}] ${finalDescription}`;
    }

    let finalEmpleadoId = empleadoId;

    // Si es admin, puede especificar empleado_id en el body
    if (user.role === "admin") {
      if (req.body.empleado_id) {
        finalEmpleadoId = req.body.empleado_id;
      } else {
        const { ensureSelfEmployee } = await import(
          "../services/ensureSelfEmployee.js"
        );
        finalEmpleadoId = await ensureSelfEmployee({
          userId: user.id,
          empresaId,
          nombre: user.nombre,
        });
      }
    }

    if (!finalEmpleadoId) {
       return res.status(403).json({ error: "Falta empleado_id" });
    }

    const emp = await sql`
      SELECT id, empresa_id
      FROM employees_180
      WHERE id = ${finalEmpleadoId}
      LIMIT 1
    `;
    if (emp.length === 0 || emp[0].empresa_id !== empresaId) {
      return res
        .status(403)
        .json({ error: "Empleado no pertenece a la empresa" });
    }

    if (cliente_id) {
      const c = await sql`
        SELECT id
        FROM clients_180
        WHERE id = ${cliente_id}
          AND empresa_id = ${empresaId}
        LIMIT 1
      `;
      if (c.length === 0) {
        return res
          .status(400)
          .json({ error: "Cliente no válido para esta empresa" });
      }
    }

    const minutosN = minutos == null ? 0 : parseIntOrNull(minutos);
    // if (minutosN == null || minutosN < 0 || minutosN > 24 * 60 * 31) { // Cap high
    //   // return res.status(400).json({ error: "Minutos fuera de rango" });
    // }
    
    // Si es valorado sin precio fijo, minutos puede ser 0
    if (tipo_facturacion !== 'valorado' && minutosN <= 0) {
        console.log("❌ Error duracion invalida:", minutosN, tipo_facturacion);
        return res.status(400).json({ error: "Duración inválida" });
    }

    if (fecha && isNaN(new Date(fecha).getTime())) {
      console.log("❌ Error fecha invalida");
      return res.status(400).json({ error: "Fecha no válida" });
    }

    const fechaFinal = fecha ? new Date(fecha) : new Date();

    // Calcular valor inicial
    let valorInicial = 0;
    
    // 1. Si viene precio manual (desde admin), manda
    if (precio) {
        valorInicial = Number(precio);
    } 
    // 2. Si es calculado (hora, dia, mes)
    else if (cliente_id) {
       // Buscar tarifa
       const tariffs = await sql`
          SELECT precio, tipo 
          FROM client_tariffs_180 
          WHERE cliente_id = ${cliente_id} AND activo = true
          ORDER BY created_at DESC
          LIMIT 1
       `;

       if (tariffs.length > 0) {
           const tar = tariffs[0];
           const p = Number(tar.precio);

           // Normalización:
           // Las horas, dias, meses las almacenamos en 'minutos' (calculado en front)
           // Aquí calculamos valor en base a la TARIFA del cliente
           
           if (tar.tipo === 'hora') {
               // Tarifa en horas.
               valorInicial = (minutosN / 60) * p;
           } else if (tar.tipo === 'dia') {
               // Tarifa en dias. Asumimos 8h (480min) = 1 dia para la conversion
               valorInicial = (minutosN / (8 * 60)) * p;
           } else if (tar.tipo === 'mes') {
               // Tarifa en meses. 
               // Estandard: 1 mes = 160 horas (4 semanas * 40h) ó 22 dias laborales * 8h = 176h
               // User intent: "un mes de trabajo" = 9600 min (160h).
               // Si el user metió min=9600, y la tarifa es 1000€/mes => (9600 / 9600) * 1000 = 1000.
               // Asumiremos 160h/mes como base de conversión. 
               const minMes = 160 * 60; 
               valorInicial = (minutosN / minMes) * p;
           }
           // Redondear a 2 decimales
           valorInicial = Math.round(valorInicial * 100) / 100;
       }
    }

    const rows = await sql`
      INSERT INTO work_logs_180
        (
          empresa_id,
          employee_id,
          cliente_id,
          work_item_id,
          descripcion,
          fecha,
          minutos,
          valor,
          pagado,
          estado_pago,
          created_at,
          tipo_facturacion,
          duracion_texto
        )
      VALUES
        (
          ${empresaId},
          ${finalEmpleadoId},
          ${cliente_id || null},
          ${null},
          ${finalDescription},
          ${fechaFinal.toISOString()},
          ${minutosN},
          ${valorInicial},
          0,
          'pendiente',
          now(),
          ${tipo_facturacion},
          ${duracion_texto || null}
        )
      RETURNING *
    `;

    return res.json(rows[0]);
  } catch (err) {
    console.error("❌ crearWorkLog:", err);
    return res.status(500).json({ error: "Error creando work log: " + err.message });
  }
}

export async function fixWorkLogValues(req, res) {
    if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
    
    // Copy paste logic from script roughly
    const jobs = await sql`
        SELECT w.id, w.cliente_id, w.minutos 
        FROM work_logs_180 w
        WHERE (w.valor IS NULL OR w.valor = 0)
          AND w.minutos > 0
    `;

    let count = 0;
    for (const job of jobs) {
        if (!job.cliente_id) continue;
        const tariffs = await sql`
            SELECT precio, tipo FROM client_tariffs_180 
            WHERE cliente_id = ${job.cliente_id} AND activo = true
            ORDER BY created_at DESC LIMIT 1
        `;
        if (tariffs.length > 0) {
            const tar = tariffs[0];
            let nuevoValor = 0;
            if (tar.tipo === 'hora') {
                nuevoValor = (job.minutos / 60) * Number(tar.precio);
            } else if (tar.tipo === 'dia') {
                nuevoValor = (job.minutos / (8 * 60)) * Number(tar.precio);
            }
            if (nuevoValor > 0) {
                await sql`UPDATE work_logs_180 SET valor=${nuevoValor} WHERE id=${job.id}`;
                count++;
            }
        }
    }
    res.json({ fixed: count, total_checked: jobs.length });
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

    const desde = req.query.desde || '2000-01-01';
    const hasta = req.query.hasta || '2100-01-01';

    const rows = await sql`
      SELECT
        w.*,
        w.tipo_facturacion,
        w.duracion_texto,
        c.nombre AS cliente_nombre,
        wi.nombre AS work_item_nombre
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      LEFT JOIN clients_180 c ON c.id = w.cliente_id
      LEFT JOIN work_items_180 wi ON wi.id = w.work_item_id
      WHERE w.employee_id = ${empleadoId}
        AND e.empresa_id = ${empresaId}
        AND w.fecha::date >= ${desde}::date 
        AND w.fecha::date <= ${hasta}::date
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

    const desde = req.query.desde || '2000-01-01';
    const hasta = req.query.hasta || '2100-01-01';
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
        w.descripcion,
        w.valor,
        w.pagado,
        w.estado_pago,
        w.tipo_facturacion,
        w.duracion_texto,
        e.id AS empleado_id,
        e.nombre AS empleado_nombre,
        c.id AS cliente_id,
        c.nombre AS cliente_nombre,
        wi.nombre AS work_item_nombre
      FROM work_logs_180 w
      JOIN employees_180 e ON e.id = w.employee_id
      LEFT JOIN clients_180 c ON c.id = w.cliente_id
      LEFT JOIN work_items_180 wi ON wi.id = w.work_item_id
      WHERE e.empresa_id = ${empresaId}
        AND w.fecha::date >= ${desde}::date 
        AND w.fecha::date <= ${hasta}::date
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
      LEFT JOIN clients_180 c ON c.id = w.cliente_id
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
