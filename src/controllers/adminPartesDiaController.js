import { sql } from "../db.js";

export async function getPartesDia(req, res) {
  try {
    const {
      fecha,
      cliente_id,
      fecha_inicio,
      fecha_fin,
      sortBy = 'fecha',
      sortOrder = 'desc'
    } = req.query;

    const empresaId = req.user.empresa_id;

    // Construcción dinámica de la query
    let query = sql`
      SELECT 
        pd.*, 
        e.nombre as empleado_nombre,
        c.nombre as cliente_nombre
      FROM partes_dia_180 pd
      JOIN employees_180 e ON pd.empleado_id = e.id
      LEFT JOIN clients_180 c ON pd.cliente_id = c.id
      WHERE pd.empresa_id = ${empresaId}
    `;

    // Filtros
    if (fecha) {
      query = sql`${query} AND pd.fecha = ${fecha}`;
    }
    if (cliente_id) {
      query = sql`${query} AND pd.cliente_id = ${cliente_id}`;
    }
    if (fecha_inicio) {
      query = sql`${query} AND pd.fecha >= ${fecha_inicio}`;
    }
    if (fecha_fin) {
      query = sql`${query} AND pd.fecha <= ${fecha_fin}`;
    }

    // Ordenación segura
    const allowedSortFields = ['fecha', 'empleado_nombre', 'cliente_nombre', 'horas_trabajadas', 'estado'];
    const field = allowedSortFields.includes(sortBy) ? sortBy : 'fecha';
    const order = sortOrder.toLowerCase() === 'asc' ? sql`ASC` : sql`DESC`;

    // Para campos de tablas unidas, especificamos el origen si es necesario
    let orderClause;
    if (field === 'empleado_nombre') orderClause = sql`e.nombre ${order}`;
    else if (field === 'cliente_nombre') orderClause = sql`c.nombre ${order}`;
    else orderClause = sql`pd.${sql(field)} ${order}`;

    const items = await sql`
      ${query}
      ORDER BY ${orderClause}
    `;

    res.json({ items });
  } catch (error) {
    console.error("❌ Error en getPartesDia:", error);
    res.status(500).json({ error: "Error obteniendo partes del día" });
  }
}

export async function validarParte(req, res) {
  try {
    const { empleado_id, fecha, validado, nota_admin } = req.body;
    const empresaId = req.user.empresa_id;

    await sql`
      UPDATE partes_dia_180
      SET 
        validado = ${validado},
        nota_admin = ${nota_admin || null},
        validado_at = now()
      WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleado_id}
      AND fecha = ${fecha}
    `;

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error validando parte" });
  }
}

export async function validarPartesMasivo(req, res) {
  try {
    const { seleccionados, validado, nota_admin } = req.body;
    const empresaId = req.user.empresa_id;

    if (!Array.isArray(seleccionados) || seleccionados.length === 0) {
      return res.status(400).json({ error: "No hay elementos seleccionados" });
    }

    // Ejecutamos en lote
    await sql.begin(async (sql) => {
      for (const item of seleccionados) {
        await sql`
          UPDATE partes_dia_180
          SET 
            validado = ${validado},
            nota_admin = ${nota_admin || null},
            validado_at = now()
          WHERE empresa_id = ${empresaId}
          AND empleado_id = ${item.empleado_id}
          AND fecha = ${item.fecha}
        `;
      }
    });

    res.json({ success: true, count: seleccionados.length });
  } catch (error) {
    console.error("❌ Error en validarPartesMasivo:", error);
    res.status(500).json({ error: "Error en la validación masiva" });
  }
}
