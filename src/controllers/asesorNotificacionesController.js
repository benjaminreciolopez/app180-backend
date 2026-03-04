// backend/src/controllers/asesorNotificacionesController.js
// Notificaciones para el portal del asesor
import { sql } from "../db.js";

/**
 * GET /asesor/notificaciones
 * Lista notificaciones del asesor, paginadas
 */
export async function getNotificacionesAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    const notificaciones = await sql`
      SELECT id, tipo, titulo, mensaje, leida, accion_url, accion_label,
             metadata, empresa_id, created_at, leida_at,
             (SELECT COUNT(*)::int FROM notificaciones_asesor_180
              WHERE asesoria_id = ${asesoriaId}
                AND (user_id IS NULL OR user_id = ${userId})
                AND leida = FALSE) AS _no_leidas
      FROM notificaciones_asesor_180
      WHERE asesoria_id = ${asesoriaId}
        AND (user_id IS NULL OR user_id = ${userId})
      ORDER BY created_at DESC
      LIMIT ${parsedLimit} OFFSET ${parsedOffset}
    `;

    const no_leidas = notificaciones[0]?._no_leidas || 0;
    const cleaned = notificaciones.map(({ _no_leidas, ...rest }) => rest);

    res.json({ notificaciones: cleaned, no_leidas });
  } catch (err) {
    console.error("Error getNotificacionesAsesor:", err);
    res.status(500).json({ error: "Error obteniendo notificaciones" });
  }
}

/**
 * PUT /asesor/notificaciones/:id/marcar-leida
 */
export async function marcarLeidaAsesor(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;

    await sql`
      UPDATE notificaciones_asesor_180
      SET leida = TRUE, leida_at = NOW()
      WHERE id = ${id} AND asesoria_id = ${asesoriaId}
    `;

    res.json({ success: true });
  } catch (err) {
    console.error("Error marcarLeidaAsesor:", err);
    res.status(500).json({ error: "Error marcando notificacion" });
  }
}

/**
 * PUT /asesor/notificaciones/marcar-todas-leidas
 */
export async function marcarTodasLeidasAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    await sql`
      UPDATE notificaciones_asesor_180
      SET leida = TRUE, leida_at = NOW()
      WHERE asesoria_id = ${asesoriaId} AND leida = FALSE
    `;

    res.json({ success: true });
  } catch (err) {
    console.error("Error marcarTodasLeidasAsesor:", err);
    res.status(500).json({ error: "Error marcando notificaciones" });
  }
}

/**
 * DELETE /asesor/notificaciones/limpiar
 */
export async function limpiarNotificacionesAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    const result = await sql`
      DELETE FROM notificaciones_asesor_180
      WHERE asesoria_id = ${asesoriaId} AND leida = TRUE
    `;

    res.json({ success: true, deleted: result.count });
  } catch (err) {
    console.error("Error limpiarNotificacionesAsesor:", err);
    res.status(500).json({ error: "Error limpiando notificaciones" });
  }
}

/**
 * Helper: Crear notificacion del asesor (sin req/res)
 * Usado internamente por cron jobs y otros controladores
 */
export async function crearNotificacionAsesor({
  asesoriaId,
  userId = null,
  tipo,
  titulo,
  mensaje,
  accionUrl = null,
  accionLabel = null,
  metadata = null,
  empresaId = null,
}) {
  try {
    await sql`
      INSERT INTO notificaciones_asesor_180 (
        asesoria_id, user_id, tipo, titulo, mensaje,
        accion_url, accion_label, metadata, empresa_id
      ) VALUES (
        ${asesoriaId}, ${userId}, ${tipo}, ${titulo}, ${mensaje},
        ${accionUrl}, ${accionLabel}, ${metadata ? JSON.stringify(metadata) : null}, ${empresaId}
      )
    `;
  } catch (err) {
    console.error("Error crearNotificacionAsesor:", err);
  }
}
