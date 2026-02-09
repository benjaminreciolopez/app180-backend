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
  return Number.isFinite(n) ? Math.round(n) : null;
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
      detalles,
      fecha,
      minutos,
      precio,
      tipo_facturacion = 'hora',
      duracion_texto,
      save_as_template = false
    } = req.body;

    console.log("📝 crearWorkLog Payload:", JSON.stringify(req.body));

    if (!descripcion || descripcion.trim().length < 2) {
      console.log("❌ Error description length");
      return res.status(400).json({ error: "La descripción es obligatoria" });
    }

    // 0. Resolver work_item_id desde el nombre
    let finalWorkItemId = null;
    if (work_item_nombre && work_item_nombre.trim()) {
      const name = work_item_nombre.trim();
      const existingItem = await sql`
        SELECT id FROM work_items_180 
        WHERE empresa_id = ${empresaId} AND LOWER(nombre) = LOWER(${name})
        LIMIT 1
      `;
      if (existingItem.length > 0) {
        finalWorkItemId = existingItem[0].id;
      } else {
        const [newItem] = await sql`
          INSERT INTO work_items_180 (empresa_id, nombre)
          VALUES (${empresaId}, ${name})
          RETURNING id
        `;
        finalWorkItemId = newItem.id;
      }
    }

    // Concatenar tipo si existe: "[Tipo] Descripción..."
    const cleanDesc = descripcion.trim();
    let finalDescription = cleanDesc;
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
          detalles,
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
          ${finalWorkItemId},
          ${finalDescription},
          ${detalles || null},
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

    // Si se pide guardar como plantilla
    if (save_as_template && finalDescription) {
      // Evitar duplicados exactos en plantillas por empresa
      const existingTpl = await sql`
        SELECT id FROM work_log_templates_180 
        WHERE empresa_id = ${empresaId} AND descripcion = ${finalDescription}
        LIMIT 1
      `;
      if (existingTpl.length === 0) {
        await sql`
          INSERT INTO work_log_templates_180 (empresa_id, descripcion, detalles)
          VALUES (${empresaId}, ${finalDescription}, ${detalles || null})
        `;
      }
    }

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

/**
 * PUT /worklogs/:id
 */
export async function actualizarWorkLog(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;
    const {
      descripcion, detalles, fecha, minutos, precio,
      tipo_facturacion, duracion_texto, cliente_id, empleado_id,
      save_as_template = false
    } = req.body;

    // Verificar propiedad (o ser admin)
    const existing = await sql`
      SELECT id, employee_id, empresa_id, pagado, cliente_id, minutos, tipo_facturacion, valor 
      FROM work_logs_180 WHERE id = ${id}
    `;
    if (!existing[0]) return res.status(404).json({ error: "Trabajo no encontrado" });
    if (existing[0].empresa_id !== empresaId) return res.status(403).json({ error: "No autorizado" });

    // Bloqueo si está pagado
    if (existing[0].pagado > 0) {
      return res.status(400).json({ error: "No se puede editar un trabajo ya pagado o facturado. Elimina el pago primero." });
    }

    if (req.user.role !== 'admin' && existing[0].employee_id !== req.user.empleado_id) {
      return res.status(403).json({ error: "No puedes editar trabajos de otros" });
    }

    const updateFields = {};
    if (descripcion) updateFields.descripcion = descripcion;
    if (detalles !== undefined) updateFields.detalles = detalles;
    if (fecha) {
      if (isNaN(new Date(fecha).getTime())) {
        return res.status(400).json({ error: "Fecha no válida" });
      }
      updateFields.fecha = new Date(fecha).toISOString();
    }
    if (minutos !== undefined) updateFields.minutos = parseIntOrNull(minutos);
    if (precio !== undefined) updateFields.valor = Number(precio);
    if (tipo_facturacion) updateFields.tipo_facturacion = tipo_facturacion;
    if (duracion_texto !== undefined) updateFields.duracion_texto = duracion_texto;
    if (cliente_id) updateFields.cliente_id = cliente_id;

    // --- RECALCULO DE PRECIO AUTOMÁTICO ---
    // Si no se especifica precio manual, y cambian factores clave (o el valor era 0)
    if (precio === undefined) {
      const effectiveClienteId = cliente_id || existing[0].cliente_id;
      const effectiveMinutos = minutos !== undefined ? parseIntOrNull(minutos) : existing[0].minutos;
      // const effectiveTipo = tipo_facturacion || existing[0].tipo_facturacion;

      const factorChanged = (cliente_id && cliente_id !== existing[0].cliente_id) ||
        (minutos !== undefined && parseIntOrNull(minutos) !== existing[0].minutos) ||
        (tipo_facturacion && tipo_facturacion !== existing[0].tipo_facturacion);

      const currentValueIsZero = Number(existing[0].valor) === 0;

      if ((factorChanged || currentValueIsZero) && effectiveClienteId && effectiveMinutos > 0) {
        const tariffs = await sql`
              SELECT precio, tipo 
              FROM client_tariffs_180 
              WHERE cliente_id = ${effectiveClienteId} AND activo = true
              ORDER BY created_at DESC
              LIMIT 1
           `;

        if (tariffs.length > 0) {
          const tar = tariffs[0];
          const p = Number(tar.precio);
          let nuevoValor = 0;

          if (tar.tipo === 'hora') {
            nuevoValor = (effectiveMinutos / 60) * p;
          } else if (tar.tipo === 'dia') {
            nuevoValor = (effectiveMinutos / (8 * 60)) * p; // Asumiendo 8h jornada
          } else if (tar.tipo === 'mes') {
            const minMes = 160 * 60; // 160h base
            nuevoValor = (effectiveMinutos / minMes) * p;
          }
          updateFields.valor = Math.round(nuevoValor * 100) / 100;
        }
      }
    }

    // Si es admin, permitir cambiar empleado
    if (req.user.role === 'admin' && empleado_id) {
      updateFields.employee_id = empleado_id;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: "Nada que actualizar" });
    }

    const [updated] = await sql`
      UPDATE work_logs_180 
      SET ${sql(updateFields)}
      WHERE id = ${id}
      RETURNING *
    `;

    // Si se pide guardar como plantilla
    if (save_as_template) {
      const finalDesc = updated.descripcion;
      const finalDetalles = updated.detalles;

      const existingTpl = await sql`
        SELECT id FROM work_log_templates_180 
        WHERE empresa_id = ${empresaId} AND descripcion = ${finalDesc}
        LIMIT 1
      `;
      if (existingTpl.length === 0) {
        await sql`
          INSERT INTO work_log_templates_180 (empresa_id, descripcion, detalles)
          VALUES (${empresaId}, ${finalDesc}, ${finalDetalles || null})
        `;
      }
    }

    res.json(updated);
  } catch (err) {
    console.error("❌ actualizarWorkLog:", err);
    res.status(500).json({ error: "Error actualizando trabajo: " + err.message });
  }
}

/**
 * DELETE /worklogs/:id
 */
export async function eliminarWorkLog(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    // Verificar propiedad (o ser admin)
    const existing = await sql`
      SELECT id, employee_id, empresa_id, pagado FROM work_logs_180 WHERE id = ${id}
    `;
    if (!existing[0]) return res.status(404).json({ error: "Trabajo no encontrado" });
    if (existing[0].empresa_id !== empresaId) return res.status(403).json({ error: "No autorizado" });

    if (req.user.role !== 'admin' && existing[0].employee_id !== req.user.empleado_id) {
      return res.status(403).json({ error: "No puedes borrar trabajos de otros" });
    }

    if (existing[0].pagado > 0) {
      return res.status(400).json({ error: "No se puede borrar un trabajo ya pagado o facturado. Elimina el pago primero." });
    }

    await sql`DELETE FROM work_logs_180 WHERE id = ${id}`;
    res.json({ success: true });
  } catch (err) {
    console.error("❌ eliminarWorkLog:", err);
    res.status(500).json({ error: "Error eliminando trabajo" });
  }
}

/**
 * POST /worklogs/clonar
 * Clona un trabajo base a múltiples fechas.
 */
export async function clonarWorkLog(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { work_log_id, fechas, cliente_id } = req.body;

    if (!work_log_id || !fechas || !Array.isArray(fechas)) {
      return res.status(400).json({ error: "Datos insuficientes (work_log_id y array de fechas requeridos)" });
    }

    const [base] = await sql`
      SELECT * FROM work_logs_180 WHERE id = ${work_log_id} AND empresa_id = ${empresaId}
    `;
    if (!base) return res.status(404).json({ error: "Trabajo base no encontrado" });

    const results = [];
    for (const f of fechas) {
      const fechaClon = new Date(f);
      if (isNaN(fechaClon.getTime())) continue;

      const [newRow] = await sql`
        INSERT INTO work_logs_180 (
          empresa_id, employee_id, cliente_id, work_item_id,
          descripcion, detalles, fecha, minutos, valor,
          pagado, estado_pago, created_at, tipo_facturacion, duracion_texto
        ) VALUES (
          ${empresaId}, ${base.employee_id}, ${cliente_id || base.cliente_id}, ${base.work_item_id},
          ${base.descripcion}, ${base.detalles}, ${fechaClon.toISOString()}, ${base.minutos}, ${base.valor},
          0, 'pendiente', now(), ${base.tipo_facturacion}, ${base.duracion_texto}
        )
        RETURNING *
      `;
      results.push(newRow);
    }

    res.json({ cloned: results.length, items: results });
  } catch (err) {
    console.error("❌ clonarWorkLog:", err);
    res.status(500).json({ error: "Error clonando trabajo" });
  }
}

/**
 * GET /worklogs/templates
 */
export async function getTemplates(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const rows = await sql`
      SELECT id, descripcion, detalles 
      FROM work_log_templates_180 
      WHERE empresa_id = ${empresaId}
      ORDER BY descripcion ASC
    `;
    res.json(rows);
  } catch (err) {
    console.error("❌ getTemplates:", err);
    res.status(500).json({ error: "Error obteniendo plantillas" });
  }
}

/**
 * DELETE /worklogs/templates/:id
 */
export async function deleteTemplate(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;
    await sql`
      DELETE FROM work_log_templates_180 
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;
    res.json({ success: true });
  } catch (err) {
    console.error("❌ deleteTemplate:", err);
    res.status(500).json({ error: "Error eliminando plantilla" });
  }
}

/**
 * GET /worklogs/suggestions
 * Devuelve listas únicas para autocompletado inteligente.
 */
export async function getSuggestions(req, res) {
  try {
    const empresaId = req.user.empresa_id;

    // 1. Tipos (de la tabla de items)
    const types = await sql`
      SELECT DISTINCT nombre 
      FROM work_items_180 
      WHERE empresa_id = ${empresaId}
      ORDER BY nombre ASC
    `;

    // 2. Plantillas (combinación de desc y detalles)
    const templates = await sql`
      SELECT descripcion, detalles 
      FROM work_log_templates_180 
      WHERE empresa_id = ${empresaId}
    `;

    // 3. Recientes (opcional, para dar más variedad)
    const recent = await sql`
      SELECT w.descripcion, w.detalles, wi.nombre as work_item_nombre
      FROM work_logs_180 w
      LEFT JOIN work_items_180 wi ON wi.id = w.work_item_id
      WHERE w.empresa_id = ${empresaId}
      ORDER BY w.created_at DESC
      LIMIT 100
    `;

    res.json({
      types: types.map(t => t.nombre),
      templates,
      recent
    });
  } catch (err) {
    console.error("❌ getSuggestions:", err);
    res.status(500).json({ error: "Error obteniendo sugerencias" });
  }
}
