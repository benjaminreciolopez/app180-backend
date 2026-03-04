// backend/src/controllers/asesoriaMensajesController.js
// WhatsApp-like messaging between asesor and client
import { sql } from "../db.js";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

/**
 * Resolves the asesoria_id and empresa_id depending on which side is calling.
 * - Asesor side: asesoria_id from token, empresa_id from params
 * - Admin side: empresa_id from token, look up linked asesoria
 */
async function resolveContext(req) {
  if (req.user.role === "asesor") {
    return {
      asesoriaId: req.user.asesoria_id,
      empresaId: req.params.empresa_id || req.query.empresa_id,
    };
  }

  // Admin side: find linked asesoria for this empresa
  const empresaId = req.user.empresa_id;
  const rows = await sql`
    SELECT asesoria_id
    FROM asesoria_clientes_180
    WHERE empresa_id = ${empresaId}
      AND estado = 'activo'
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { asesoriaId: null, empresaId };
  }

  return {
    asesoriaId: rows[0].asesoria_id,
    empresaId,
  };
}

/**
 * GET /asesor/clientes/:empresa_id/mensajes  (asesor side)
 * GET /admin/asesoria/mensajes               (admin side)
 * Paginated messages ordered by created_at DESC
 */
export async function getMensajes(req, res) {
  try {
    const { asesoriaId, empresaId } = await resolveContext(req);

    if (!asesoriaId) {
      return res.status(404).json({ error: "No hay asesoría vinculada" });
    }
    if (!empresaId) {
      return res.status(400).json({ error: "empresa_id requerido" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;

    const mensajes = await sql`
      SELECT
        m.id,
        m.contenido,
        m.tipo,
        m.adjuntos,
        m.autor_id,
        m.autor_tipo,
        m.leido,
        m.leido_at,
        m.created_at,
        u.nombre AS autor_nombre,
        u.avatar_url AS autor_avatar
      FROM asesoria_mensajes_180 m
      LEFT JOIN users_180 u ON u.id = m.autor_id
      WHERE m.asesoria_id = ${asesoriaId}
        AND m.empresa_id = ${empresaId}
      ORDER BY m.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const [countResult] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_mensajes_180
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresaId}
    `;

    return res.json({
      success: true,
      data: mensajes,
      pagination: {
        page,
        limit,
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit),
      },
    });
  } catch (err) {
    console.error("Error getMensajes (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo mensajes" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/mensajes  (asesor side)
 * POST /admin/asesoria/mensajes               (admin side)
 * Send a message
 */
export async function enviarMensaje(req, res) {
  try {
    const { asesoriaId, empresaId } = await resolveContext(req);

    if (!asesoriaId) {
      return res.status(404).json({ error: "No hay asesoría vinculada" });
    }
    if (!empresaId) {
      return res.status(400).json({ error: "empresa_id requerido" });
    }

    const { contenido, tipo, adjuntos } = req.body;

    if (!contenido || typeof contenido !== "string" || !contenido.trim()) {
      return res.status(400).json({ error: "El contenido del mensaje es requerido" });
    }

    const autorTipo = req.user.role === "asesor" ? "asesor" : "admin";

    const [mensaje] = await sql`
      INSERT INTO asesoria_mensajes_180 (
        asesoria_id,
        empresa_id,
        autor_id,
        autor_tipo,
        contenido,
        tipo,
        adjuntos,
        leido,
        created_at
      )
      VALUES (
        ${asesoriaId},
        ${empresaId},
        ${req.user.id},
        ${autorTipo},
        ${contenido.trim()},
        ${tipo || "mensaje"},
        ${adjuntos ? sql.json(adjuntos) : null},
        false,
        now()
      )
      RETURNING *
    `;

    // Trigger notification for the other side
    triggerMensajeNotificacion({ asesoriaId, empresaId, autorTipo, req }).catch(() => {});

    return res.status(201).json({ success: true, data: mensaje });
  } catch (err) {
    console.error("Error enviarMensaje (asesoria):", err);
    return res.status(500).json({ error: "Error enviando mensaje" });
  }
}

/**
 * PUT /asesor/clientes/:empresa_id/mensajes/:id/leido  (asesor side)
 * PUT /admin/asesoria/mensajes/:id/leido               (admin side)
 * Mark a message as read
 */
export async function marcarLeido(req, res) {
  try {
    const mensajeId = req.params.id;

    const [updated] = await sql`
      UPDATE asesoria_mensajes_180
      SET leido = true,
          leido_at = now()
      WHERE id = ${mensajeId}
      RETURNING id, leido, leido_at
    `;

    if (!updated) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("Error marcarLeido (asesoria):", err);
    return res.status(500).json({ error: "Error marcando mensaje como leído" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/mensajes/no-leidos  (asesor side)
 * GET /admin/asesoria/mensajes/no-leidos               (admin side)
 * Count unread messages for the current user side
 */
export async function getNoLeidos(req, res) {
  try {
    const { asesoriaId, empresaId } = await resolveContext(req);

    if (!asesoriaId) {
      return res.json({ success: true, data: { total: 0 } });
    }

    // For asesor: count messages authored by admin (not yet read)
    // For admin: count messages authored by asesor (not yet read)
    const otroTipo = req.user.role === "asesor" ? "admin" : "asesor";

    if (empresaId) {
      // Specific empresa
      const [result] = await sql`
        SELECT COUNT(*)::int AS total
        FROM asesoria_mensajes_180
        WHERE asesoria_id = ${asesoriaId}
          AND empresa_id = ${empresaId}
          AND autor_tipo = ${otroTipo}
          AND leido = false
      `;
      return res.json({ success: true, data: { total: result.total } });
    }

    // Asesor without specific empresa: count across all linked empresas
    const [result] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_mensajes_180
      WHERE asesoria_id = ${asesoriaId}
        AND autor_tipo = ${otroTipo}
        AND leido = false
    `;

    return res.json({ success: true, data: { total: result.total } });
  } catch (err) {
    console.error("Error getNoLeidos (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo mensajes no leídos" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/mensajes/con-adjunto  (asesor side)
 * POST /admin/asesoria/mensajes/con-adjunto               (admin side)
 * Send a message with file attachment (multipart)
 */
export async function enviarMensajeConAdjunto(req, res) {
  try {
    const { asesoriaId, empresaId } = await resolveContext(req);

    if (!asesoriaId) {
      return res.status(404).json({ error: "No hay asesoría vinculada" });
    }
    if (!empresaId) {
      return res.status(400).json({ error: "empresa_id requerido" });
    }

    const file = req.file;
    const { contenido = "" } = req.body;

    if (!file && (!contenido || !contenido.trim())) {
      return res.status(400).json({ error: "Se requiere un mensaje o un archivo adjunto" });
    }

    let adjuntos = null;

    // Upload file to Supabase Storage if present
    if (file) {
      const filename = `${Date.now()}_${file.originalname}`;
      const storagePath = `${empresaId}/asesoria/chat/${filename}`;

      if (supabase) {
        const { error: uploadErr } = await supabase.storage
          .from("app180-files")
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });
        if (uploadErr) throw new Error(`Error subiendo archivo: ${uploadErr.message}`);
      }

      // Also store in documentos_asesoria_180 for traceability
      const subidoPorTipo = req.user.role === "asesor" ? "asesor" : "admin";
      const [doc] = await sql`
        INSERT INTO documentos_asesoria_180 (
          asesoria_id, empresa_id, nombre, storage_path,
          mime_type, size_bytes, subido_por_tipo, subido_por_id, folder
        ) VALUES (
          ${asesoriaId}, ${empresaId}, ${file.originalname}, ${storagePath},
          ${file.mimetype}, ${file.size}, ${subidoPorTipo}, ${req.user.id}, 'chat'
        )
        RETURNING id, nombre, mime_type, size_bytes
      `;

      adjuntos = [{
        id: doc.id,
        nombre: doc.nombre,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        storage_path: storagePath,
      }];
    }

    const autorTipo = req.user.role === "asesor" ? "asesor" : "admin";

    const [mensaje] = await sql`
      INSERT INTO asesoria_mensajes_180 (
        asesoria_id, empresa_id, autor_id, autor_tipo,
        contenido, tipo, adjuntos, leido, created_at
      )
      VALUES (
        ${asesoriaId}, ${empresaId}, ${req.user.id}, ${autorTipo},
        ${(contenido || "").trim() || (file ? `📎 ${file.originalname}` : "")},
        ${file ? "adjunto" : "mensaje"},
        ${adjuntos ? sql.json(adjuntos) : null},
        false, now()
      )
      RETURNING *
    `;

    // Trigger notification for the other side
    triggerMensajeNotificacion({ asesoriaId, empresaId, autorTipo, req }).catch(() => {});

    return res.status(201).json({ success: true, data: mensaje });
  } catch (err) {
    console.error("Error enviarMensajeConAdjunto:", err);
    return res.status(500).json({ error: "Error enviando mensaje con adjunto" });
  }
}

/**
 * Helper: Trigger notification when a message is sent
 * Admin sends → notify asesor; Asesor sends → no notification (admin sees in-app)
 */
async function triggerMensajeNotificacion({ asesoriaId, empresaId, autorTipo, req }) {
  try {
    // Only notify asesor when admin sends a message
    if (autorTipo === "admin") {
      const { crearNotificacionAsesor } = await import("./asesorNotificacionesController.js");
      const [empresa] = await sql`SELECT nombre FROM empresa_180 WHERE id = ${empresaId}`;
      await crearNotificacionAsesor({
        asesoriaId,
        tipo: "nuevo_mensaje",
        titulo: "Nuevo mensaje",
        mensaje: `${empresa?.nombre || "Un cliente"} te ha enviado un mensaje`,
        accionUrl: `/asesor/clientes/${empresaId}/mensajes`,
        accionLabel: "Ver mensaje",
        empresaId,
      });
    }
  } catch (err) {
    console.error("Error triggerMensajeNotificacion:", err);
  }
}
