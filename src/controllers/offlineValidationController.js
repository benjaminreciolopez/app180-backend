// backend/src/controllers/offlineValidationController.js
//
// Validación administrativa de fichajes offline.
// Los fichajes sincronizados desde kioscos offline tienen estado 'pendiente_validacion'
// y requieren aprobación o rechazo del admin.

import { sql } from "../db.js";
import { generarHashFichajeNuevo } from "../services/fichajeIntegridadService.js";

/**
 * GET /admin/fichajes/offline-pendientes
 * Lista fichajes con estado 'pendiente_validacion'.
 */
export const listOfflinePendientes = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const fichajes = await sql`
      SELECT
        f.id, f.tipo, f.subtipo, f.fecha, f.estado, f.origen,
        f.offline_timestamp, f.offline_device_id, f.sync_batch_id,
        f.created_at,
        f.foto_verificacion_url,
        e.nombre AS empleado_nombre,
        e.codigo_empleado,
        e.foto_url AS empleado_foto_url,
        kd.nombre AS device_nombre
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      LEFT JOIN kiosk_devices_180 kd ON kd.id = f.offline_device_id
      WHERE f.empresa_id = ${empresaId}
        AND f.estado = 'pendiente_validacion'
      ORDER BY f.offline_timestamp ASC NULLS LAST, f.fecha ASC
      LIMIT ${Number(limit)}
      OFFSET ${offset}
    `;

    const [countResult] = await sql`
      SELECT COUNT(*)::int AS total
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND estado = 'pendiente_validacion'
    `;

    return res.json({
      fichajes,
      total: countResult.total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("❌ Error en listOfflinePendientes:", err);
    return res.status(500).json({ error: "Error al listar fichajes pendientes" });
  }
};

/**
 * POST /admin/fichajes/offline-validar
 * Aprueba o rechaza fichajes offline.
 *
 * Body: { ids: string[], accion: 'aprobar' | 'rechazar' }
 */
export const validarOfflineFichajes = async (req, res) => {
  try {
    const { ids, accion } = req.body;
    const empresaId = req.user.empresa_id;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Array de ids requerido" });
    }

    if (!["aprobar", "rechazar"].includes(accion)) {
      return res.status(400).json({ error: "Acción debe ser 'aprobar' o 'rechazar'" });
    }

    let procesados = 0;
    const errores = [];

    if (accion === "aprobar") {
      // Aprobar: cambiar estado a 'confirmado' y regenerar hash
      for (const id of ids) {
        try {
          const [fichaje] = await sql`
            SELECT id, empleado_id, empresa_id, fecha, tipo, jornada_id
            FROM fichajes_180
            WHERE id = ${id}
              AND empresa_id = ${empresaId}
              AND estado = 'pendiente_validacion'
          `;

          if (!fichaje) {
            errores.push({ id, error: "Fichaje no encontrado o ya procesado" });
            continue;
          }

          // Regenerar hash para mantener integridad de la cadena
          const hashData = await generarHashFichajeNuevo({
            empleado_id: fichaje.empleado_id,
            empresa_id: fichaje.empresa_id,
            fecha: fichaje.fecha,
            tipo: fichaje.tipo,
            jornada_id: fichaje.jornada_id,
          });

          await sql`
            UPDATE fichajes_180
            SET
              estado = 'confirmado',
              hash_actual = ${hashData.hash_actual},
              hash_anterior = ${hashData.hash_anterior},
              fecha_hash = ${hashData.fecha_hash}
            WHERE id = ${id}
          `;

          procesados++;
        } catch (err) {
          errores.push({ id, error: err.message });
        }
      }
    } else {
      // Rechazar: cambiar estado a 'rechazado_offline'
      const result = await sql`
        UPDATE fichajes_180
        SET estado = 'rechazado_offline'
        WHERE id = ANY(${ids})
          AND empresa_id = ${empresaId}
          AND estado = 'pendiente_validacion'
      `;
      procesados = result.count;
    }

    return res.json({
      success: true,
      accion,
      procesados,
      errores: errores.length > 0 ? errores : undefined,
    });
  } catch (err) {
    console.error("❌ Error en validarOfflineFichajes:", err);
    return res.status(500).json({ error: "Error al validar fichajes offline" });
  }
};

/**
 * GET /admin/fichajes/offline-pendientes/count
 * Devuelve solo el count para badge en nav.
 */
export const countOfflinePendientes = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;

    const [result] = await sql`
      SELECT COUNT(*)::int AS count
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND estado = 'pendiente_validacion'
    `;

    return res.json({ count: result.count });
  } catch (err) {
    console.error("❌ Error en countOfflinePendientes:", err);
    return res.status(500).json({ error: "Error al contar fichajes pendientes" });
  }
};
