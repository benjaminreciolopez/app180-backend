import { sql } from "../db.js";

/**
 * GET /admin/notificaciones
 * Lista las notificaciones del usuario (empresa)
 */
export async function getNotificaciones(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const asesoriaId = req.user.asesoria_id;
    const userId = req.user.id;
    const isEmpleado = req.user.role === "empleado";
    const isAsesor = req.user.role === "asesor";
    const { limit = 20, offset = 0, solo_no_leidas = false } = req.query;

    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    // Asesores: filtrar por user_id (sus notificaciones personales)
    // Empleados: solo sus propias notificaciones + broadcast
    // Admin: todas las de la empresa
    let whereClause;
    let countClause;

    if (isAsesor && asesoriaId) {
      whereClause = sql`user_id = ${userId}`;
      countClause = sql`user_id = ${userId}`;
    } else {
      const userFilter = isEmpleado ? sql`AND (user_id IS NULL OR user_id = ${userId})` : sql``;
      whereClause = sql`empresa_id = ${empresaId} ${userFilter}`;
      countClause = sql`empresa_id = ${empresaId} ${userFilter}`;
    }

    // Count no leídas en query separada para evitar problemas con 0 resultados
    const [countResult] = await sql`
      SELECT COUNT(*)::int as total FROM notificaciones_180
      WHERE ${countClause} AND leida = FALSE
    `;
    const no_leidas = countResult?.total || 0;

    let notificaciones;
    if (solo_no_leidas === 'true' || solo_no_leidas === true) {
      notificaciones = await sql`
        SELECT id, tipo, titulo, mensaje, leida, accion_url, accion_label,
               metadata, created_at, leida_at
        FROM notificaciones_180
        WHERE ${whereClause} AND leida = FALSE
        ORDER BY created_at DESC
        LIMIT ${parsedLimit} OFFSET ${parsedOffset}
      `;
    } else {
      notificaciones = await sql`
        SELECT id, tipo, titulo, mensaje, leida, accion_url, accion_label,
               metadata, created_at, leida_at
        FROM notificaciones_180
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${parsedLimit} OFFSET ${parsedOffset}
      `;
    }

    const cleaned = notificaciones.map(n => ({ ...n }));

    res.json({
      notificaciones: cleaned,
      no_leidas
    });
  } catch (err) {
    console.error("Error getNotificaciones:", err);
    res.status(500).json({ error: "Error obteniendo notificaciones" });
  }
}

/**
 * PUT /admin/notificaciones/:id/marcar-leida
 * Marca una notificación como leída
 */
export async function marcarLeida(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;
    const userId = req.user.id;
    const isAsesor = req.user.role === "asesor";

    if (isAsesor) {
      await sql`
        UPDATE notificaciones_180
        SET leida = TRUE, leida_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
      `;
    } else {
      await sql`
        UPDATE notificaciones_180
        SET leida = TRUE, leida_at = NOW()
        WHERE id = ${id} AND empresa_id = ${empresaId}
      `;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error marcarLeida:", err);
    res.status(500).json({ error: "Error marcando notificación" });
  }
}

/**
 * PUT /admin/notificaciones/marcar-todas-leidas
 * Marca todas las notificaciones como leídas
 */
export async function marcarTodasLeidas(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const userId = req.user.id;
    const isAsesor = req.user.role === "asesor";

    if (isAsesor) {
      await sql`
        UPDATE notificaciones_180
        SET leida = TRUE, leida_at = NOW()
        WHERE user_id = ${userId} AND leida = FALSE
      `;
    } else {
      await sql`
        UPDATE notificaciones_180
        SET leida = TRUE, leida_at = NOW()
        WHERE empresa_id = ${empresaId} AND leida = FALSE
      `;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error marcarTodasLeidas:", err);
    res.status(500).json({ error: "Error marcando notificaciones" });
  }
}

/**
 * DELETE /admin/notificaciones/limpiar
 * Elimina todas las notificaciones leídas
 */
export async function limpiarNotificaciones(req, res) {
  try {
    const empresaId = req.user.empresa_id;

    const result = await sql`
      DELETE FROM notificaciones_180
      WHERE empresa_id = ${empresaId} AND leida = TRUE
    `;

    res.json({ success: true, deleted: result.count });
  } catch (err) {
    console.error("Error limpiarNotificaciones:", err);
    res.status(500).json({ error: "Error limpiando notificaciones" });
  }
}

/**
 * DELETE /admin/notificaciones/:id
 * Elimina una notificación (solo admin)
 */
export async function deleteNotificacion(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: "Solo administradores pueden eliminar notificaciones" });
    }

    await sql`DELETE FROM notificaciones_180 WHERE id = ${id} AND empresa_id = ${empresaId}`;

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleteNotificacion:", err);
    res.status(500).json({ error: "Error eliminando notificación" });
  }
}

/**
 * POST /admin/notificaciones (interno / service role)
 * Crea una nueva notificación
 */
export async function crearNotificacion(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { tipo, titulo, mensaje, accion_url, accion_label, metadata, user_id } = req.body;

    if (!tipo || !titulo || !mensaje) {
      return res.status(400).json({ error: "Faltan campos obligatorios: tipo, titulo, mensaje" });
    }

    const [notif] = await sql`
      INSERT INTO notificaciones_180 (
        empresa_id, user_id, tipo, titulo, mensaje,
        accion_url, accion_label, metadata
      ) VALUES (
        ${empresaId}, ${user_id || null}, ${tipo}, ${titulo}, ${mensaje},
        ${accion_url || null}, ${accion_label || null}, ${metadata ? JSON.stringify(metadata) : null}
      )
      RETURNING *
    `;

    res.json({ success: true, notificacion: notif });
  } catch (err) {
    console.error("Error crearNotificacion:", err);
    res.status(500).json({ error: "Error creando notificación" });
  }
}

/**
 * POST /admin/notificaciones/:id/responder-sugerencia
 * Acepta o rechaza una sugerencia de gasto recurrente
 * Body: { respuesta: 'aceptar' | 'rechazar' }
 */
export async function responderSugerenciaRecurrente(req, res) {
  try {
    const { id } = req.params;
    const { respuesta } = req.body;
    const empresaId = req.user.empresa_id;

    if (!['aceptar', 'rechazar'].includes(respuesta)) {
      return res.status(400).json({ error: "Respuesta inválida. Usar 'aceptar' o 'rechazar'." });
    }

    const [notif] = await sql`
      SELECT * FROM notificaciones_180
      WHERE id = ${id} AND empresa_id = ${empresaId} AND tipo = 'GASTO_RECURRENTE_SUGERIDO'
    `;

    if (!notif) {
      return res.status(404).json({ error: "Notificación no encontrada." });
    }

    const metadata = notif.metadata;
    if (!metadata || !metadata.proveedor) {
      return res.status(400).json({ error: "La notificación no tiene datos de sugerencia." });
    }

    if (respuesta === 'aceptar') {
      const dia = new Date().getDate();
      const diaEjecucion = dia <= 28 ? dia : 1;

      await sql`
        INSERT INTO gastos_recurrentes_180 (
          empresa_id, nombre, proveedor, base_imponible,
          iva_porcentaje, iva_importe, retencion_porcentaje, retencion_importe,
          total, categoria, metodo_pago, cuenta_contable, dia_ejecucion
        ) VALUES (
          ${empresaId}, ${metadata.proveedor}, ${metadata.proveedor},
          ${metadata.base_imponible}, ${metadata.iva_porcentaje != null ? metadata.iva_porcentaje : 21},
          ${metadata.iva_importe || 0}, ${metadata.retencion_porcentaje || 0},
          ${metadata.retencion_importe || 0}, ${metadata.total},
          ${metadata.categoria || 'general'}, ${metadata.metodo_pago || 'transferencia'},
          ${metadata.cuenta_contable || null}, ${diaEjecucion}
        )
      `;
    } else {
      const proveedorNorm = (metadata.proveedor_norm || metadata.proveedor).toLowerCase().trim();
      await sql`
        INSERT INTO gastos_recurrentes_silenciados_180 (empresa_id, proveedor_norm)
        VALUES (${empresaId}, ${proveedorNorm})
        ON CONFLICT (empresa_id, proveedor_norm) DO NOTHING
      `;
    }

    await sql`
      UPDATE notificaciones_180
      SET leida = TRUE, leida_at = NOW(),
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ respondido: respuesta })}::jsonb
      WHERE id = ${id}
    `;

    res.json({
      success: true,
      message: respuesta === 'aceptar'
        ? 'Gasto recurrente creado correctamente.'
        : 'Proveedor silenciado. No se volverá a sugerir.'
    });
  } catch (err) {
    console.error("Error responderSugerenciaRecurrente:", err);
    res.status(500).json({ error: "Error procesando la respuesta." });
  }
}

/**
 * Helper: Crear notificación del sistema (sin req/res)
 * Usado internamente por otros controladores
 */
export async function crearNotificacionSistema({ empresaId, userId = null, tipo, titulo, mensaje, accionUrl = null, accionLabel = null, metadata = null }) {
  try {
    await sql`
      INSERT INTO notificaciones_180 (
        empresa_id, user_id, tipo, titulo, mensaje,
        accion_url, accion_label, metadata
      ) VALUES (
        ${empresaId}, ${userId}, ${tipo}, ${titulo}, ${mensaje},
        ${accionUrl}, ${accionLabel}, ${metadata ? JSON.stringify(metadata) : null}
      )
    `;
  } catch (err) {
    console.error("Error crearNotificacionSistema:", err);
  }
}
