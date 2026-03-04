// backend/src/controllers/asesorDocumentosController.js
// Documentos compartidos entre asesor y cliente
import { createClient } from "@supabase/supabase-js";
import { sql } from "../db.js";

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// ── Helpers ──────────────────────────────────────────────

async function uploadToSupabase(empresaId, file, folder) {
  const filename = `${Date.now()}_${file.originalname}`;
  const storagePath = `${empresaId}/asesoria/${folder}/${filename}`;

  if (supabase) {
    const { error } = await supabase.storage
      .from("app180-files")
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) throw new Error(`Error subiendo archivo: ${error.message}`);
  }

  return storagePath;
}

async function getSignedUrl(storagePath) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from("app180-files")
    .createSignedUrl(storagePath, 300); // 5 min
  if (error) return null;
  return data.signedUrl;
}

// ── Asesor endpoints ─────────────────────────────────────

/**
 * GET /asesor/clientes/:empresa_id/documentos
 * Lista documentos compartidos con un cliente
 */
export async function getDocumentosCliente(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;
    const { folder } = req.query;

    let docs;
    if (folder && folder !== "todos") {
      docs = await sql`
        SELECT d.*, u.nombre AS subido_por_nombre
        FROM documentos_asesoria_180 d
        LEFT JOIN users_180 u ON u.id = d.subido_por_id
        WHERE d.asesoria_id = ${asesoriaId}
          AND d.empresa_id = ${empresaId}
          AND d.folder = ${folder}
        ORDER BY d.created_at DESC
      `;
    } else {
      docs = await sql`
        SELECT d.*, u.nombre AS subido_por_nombre
        FROM documentos_asesoria_180 d
        LEFT JOIN users_180 u ON u.id = d.subido_por_id
        WHERE d.asesoria_id = ${asesoriaId}
          AND d.empresa_id = ${empresaId}
        ORDER BY d.created_at DESC
      `;
    }

    res.json({ success: true, data: docs });
  } catch (err) {
    console.error("Error getDocumentosCliente:", err);
    res.status(500).json({ error: "Error obteniendo documentos" });
  }
}

/**
 * POST /asesor/clientes/:empresa_id/documentos/upload
 * Asesor sube documento para un cliente
 */
export async function uploadDocumentoAsesor(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;
    const userId = req.user.id;
    const file = req.file;
    const { folder = "general", descripcion = "" } = req.body;

    if (!file) return res.status(400).json({ error: "No se adjunto archivo" });

    const storagePath = await uploadToSupabase(empresaId, file, folder);

    const [doc] = await sql`
      INSERT INTO documentos_asesoria_180 (
        asesoria_id, empresa_id, nombre, descripcion, storage_path,
        mime_type, size_bytes, subido_por_tipo, subido_por_id, folder
      ) VALUES (
        ${asesoriaId}, ${empresaId}, ${file.originalname}, ${descripcion},
        ${storagePath}, ${file.mimetype}, ${file.size}, 'asesor', ${userId}, ${folder}
      )
      RETURNING *
    `;

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Error uploadDocumentoAsesor:", err);
    res.status(500).json({ error: "Error subiendo documento" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/documentos/:id/download
 * Descarga un documento (signed URL)
 */
export async function downloadDocumento(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;

    const [doc] = await sql`
      SELECT storage_path, nombre, mime_type
      FROM documentos_asesoria_180
      WHERE id = ${id} AND asesoria_id = ${asesoriaId}
    `;

    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });

    const url = await getSignedUrl(doc.storage_path);
    if (!url) return res.status(500).json({ error: "Error generando URL de descarga" });

    res.json({ success: true, data: { url, nombre: doc.nombre, mime_type: doc.mime_type } });
  } catch (err) {
    console.error("Error downloadDocumento:", err);
    res.status(500).json({ error: "Error descargando documento" });
  }
}

/**
 * DELETE /asesor/clientes/:empresa_id/documentos/:id
 * Elimina documento (solo documentos propios del asesor)
 */
export async function deleteDocumento(req, res) {
  try {
    const { id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const userId = req.user.id;

    const [doc] = await sql`
      SELECT id, storage_path, subido_por_id, subido_por_tipo
      FROM documentos_asesoria_180
      WHERE id = ${id} AND asesoria_id = ${asesoriaId}
    `;

    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });

    // Solo puede borrar sus propios documentos
    if (doc.subido_por_id !== userId) {
      return res.status(403).json({ error: "Solo puedes eliminar tus propios documentos" });
    }

    // Borrar de Supabase Storage
    if (supabase && doc.storage_path) {
      await supabase.storage.from("app180-files").remove([doc.storage_path]);
    }

    await sql`DELETE FROM documentos_asesoria_180 WHERE id = ${id}`;

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleteDocumento:", err);
    res.status(500).json({ error: "Error eliminando documento" });
  }
}

// ── Cliente (admin) endpoints ────────────────────────────

/**
 * GET /admin/asesoria/documentos
 * Cliente ve documentos compartidos con su asesoria
 */
export async function getMisDocumentosAsesoria(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { folder } = req.query;

    // Buscar vinculo activo
    const [vinculo] = await sql`
      SELECT asesoria_id FROM asesoria_clientes_180
      WHERE empresa_id = ${empresaId} AND estado = 'activo'
      LIMIT 1
    `;

    if (!vinculo) return res.json({ success: true, data: [] });

    let docs;
    if (folder && folder !== "todos") {
      docs = await sql`
        SELECT d.*, u.nombre AS subido_por_nombre
        FROM documentos_asesoria_180 d
        LEFT JOIN users_180 u ON u.id = d.subido_por_id
        WHERE d.asesoria_id = ${vinculo.asesoria_id}
          AND d.empresa_id = ${empresaId}
          AND d.folder = ${folder}
        ORDER BY d.created_at DESC
      `;
    } else {
      docs = await sql`
        SELECT d.*, u.nombre AS subido_por_nombre
        FROM documentos_asesoria_180 d
        LEFT JOIN users_180 u ON u.id = d.subido_por_id
        WHERE d.asesoria_id = ${vinculo.asesoria_id}
          AND d.empresa_id = ${empresaId}
        ORDER BY d.created_at DESC
      `;
    }

    res.json({ success: true, data: docs });
  } catch (err) {
    console.error("Error getMisDocumentosAsesoria:", err);
    res.status(500).json({ error: "Error obteniendo documentos" });
  }
}

/**
 * POST /admin/asesoria/documentos/upload
 * Cliente sube documento para su asesoria
 */
export async function uploadDocumentoCliente(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const userId = req.user.id;
    const file = req.file;
    const { folder = "general", descripcion = "" } = req.body;

    if (!file) return res.status(400).json({ error: "No se adjunto archivo" });

    // Buscar vinculo activo
    const [vinculo] = await sql`
      SELECT asesoria_id FROM asesoria_clientes_180
      WHERE empresa_id = ${empresaId} AND estado = 'activo'
      LIMIT 1
    `;

    if (!vinculo) return res.status(400).json({ error: "No tienes asesoria vinculada" });

    const storagePath = await uploadToSupabase(empresaId, file, folder);

    const [doc] = await sql`
      INSERT INTO documentos_asesoria_180 (
        asesoria_id, empresa_id, nombre, descripcion, storage_path,
        mime_type, size_bytes, subido_por_tipo, subido_por_id, folder
      ) VALUES (
        ${vinculo.asesoria_id}, ${empresaId}, ${file.originalname}, ${descripcion},
        ${storagePath}, ${file.mimetype}, ${file.size}, 'admin', ${userId}, ${folder}
      )
      RETURNING *
    `;

    // Crear notificacion para el asesor
    try {
      const { crearNotificacionAsesor } = await import("./asesorNotificacionesController.js");
      const [empresa] = await sql`SELECT nombre FROM empresa_180 WHERE id = ${empresaId}`;
      await crearNotificacionAsesor({
        asesoriaId: vinculo.asesoria_id,
        tipo: "nuevo_documento",
        titulo: "Nuevo documento",
        mensaje: `${empresa?.nombre || "Un cliente"} ha subido "${file.originalname}"`,
        accionUrl: `/asesor/clientes/${empresaId}/documentos`,
        accionLabel: "Ver documentos",
        empresaId,
      });
    } catch (notifErr) {
      console.error("Error creando notificacion de documento:", notifErr);
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Error uploadDocumentoCliente:", err);
    res.status(500).json({ error: "Error subiendo documento" });
  }
}

/**
 * GET /admin/asesoria/documentos/:id/download
 */
export async function downloadDocumentoCliente(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;

    const [doc] = await sql`
      SELECT storage_path, nombre, mime_type
      FROM documentos_asesoria_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });

    const url = await getSignedUrl(doc.storage_path);
    if (!url) return res.status(500).json({ error: "Error generando URL de descarga" });

    res.json({ success: true, data: { url, nombre: doc.nombre, mime_type: doc.mime_type } });
  } catch (err) {
    console.error("Error downloadDocumentoCliente:", err);
    res.status(500).json({ error: "Error descargando documento" });
  }
}

/**
 * DELETE /admin/asesoria/documentos/:id
 * Cliente elimina solo sus propios documentos
 */
export async function deleteDocumentoCliente(req, res) {
  try {
    const { id } = req.params;
    const empresaId = req.user.empresa_id;
    const userId = req.user.id;

    const [doc] = await sql`
      SELECT id, storage_path, subido_por_id
      FROM documentos_asesoria_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
    if (doc.subido_por_id !== userId) {
      return res.status(403).json({ error: "Solo puedes eliminar tus propios documentos" });
    }

    if (supabase && doc.storage_path) {
      await supabase.storage.from("app180-files").remove([doc.storage_path]);
    }

    await sql`DELETE FROM documentos_asesoria_180 WHERE id = ${id}`;

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleteDocumentoCliente:", err);
    res.status(500).json({ error: "Error eliminando documento" });
  }
}
