// src/controllers/ausenciasAdjuntosController.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// CONFIG
// =========================
const UPLOADS_ROOT = path.join(
  process.cwd(),
  "uploads",
  "ausencias_adjuntos_180"
);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

function safeBasename(name = "archivo") {
  // evita rutas raras y caracteres conflictivos
  return path
    .basename(name)
    .replace(/[^\w.\-()+\s]/g, "_")
    .slice(0, 150);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function isAdmin(req) {
  return req.user?.role === "admin";
}

function getEmpresaId(req) {
  // En tu JWT ya viaja empresa_id (lo has logueado)
  return req.user?.empresa_id || null;
}

function getEmpleadoId(req) {
  return req.user?.empleado_id || null;
}

// =========================
// AUTH HELPERS
// =========================
async function assertEmpleadoPuedeAccederAusencia({ ausenciaId, req }) {
  const empresaId = getEmpresaId(req);
  const empleadoId = getEmpleadoId(req);

  if (!empresaId || !empleadoId) {
    return { ok: false, status: 403, msg: "No autorizado" };
  }

  const rows = await sql`
    SELECT id, empresa_id, empleado_id
    FROM ausencias_180
    WHERE id = ${ausenciaId}
      AND empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
    LIMIT 1
  `;

  if (!rows.length) {
    return { ok: false, status: 404, msg: "Ausencia no encontrada" };
  }

  return { ok: true, ausencia: rows[0] };
}

async function assertAdminPuedeAccederAusencia({ ausenciaId, req }) {
  const empresaId = getEmpresaId(req);
  if (!empresaId) return { ok: false, status: 403, msg: "No autorizado" };

  const rows = await sql`
    SELECT id, empresa_id, empleado_id
    FROM ausencias_180
    WHERE id = ${ausenciaId}
      AND empresa_id = ${empresaId}
    LIMIT 1
  `;

  if (!rows.length) {
    return { ok: false, status: 404, msg: "Ausencia no encontrada" };
  }

  return { ok: true, ausencia: rows[0] };
}

async function getAdjuntoConAusencia(adjuntoId) {
  const rows = await sql`
    SELECT 
      aj.id,
      aj.ausencia_id,
      aj.storage_path,
      aj.filename,
      aj.mime_type,
      aj.size_bytes,
      aj.created_at,
      aj.creado_por,
      a.empresa_id,
      a.empleado_id
    FROM ausencias_adjuntos_180 aj
    JOIN ausencias_180 a ON a.id = aj.ausencia_id
    WHERE aj.id = ${adjuntoId}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function assertPuedeAccederAdjunto({ adjuntoId, req }) {
  const row = await getAdjuntoConAusencia(adjuntoId);
  if (!row) return { ok: false, status: 404, msg: "Adjunto no encontrado" };

  const empresaId = getEmpresaId(req);
  if (!empresaId || row.empresa_id !== empresaId) {
    return { ok: false, status: 403, msg: "No autorizado" };
  }

  if (isAdmin(req)) return { ok: true, row };

  const empleadoId = getEmpleadoId(req);
  if (!empleadoId || row.empleado_id !== empleadoId) {
    return { ok: false, status: 403, msg: "No autorizado" };
  }

  return { ok: true, row };
}

async function assertPuedeBorrarAdjunto({ adjuntoId, req }) {
  const row = await getAdjuntoConAusencia(adjuntoId);
  if (!row) return { ok: false, status: 404, msg: "Adjunto no encontrado" };

  const empresaId = getEmpresaId(req);
  if (!empresaId || row.empresa_id !== empresaId) {
    return { ok: false, status: 403, msg: "No autorizado" };
  }

  // Admin siempre
  if (isAdmin(req)) return { ok: true, row };

  // Empleado: solo el que lo subió
  if (row.creado_por && row.creado_por === req.user.id) {
    return { ok: true, row };
  }

  return { ok: false, status: 403, msg: "No autorizado" };
}

// =========================
// MULTER (middleware se declara en routes)
// =========================
export function buildUploadPath({ req, ausenciaId }) {
  const empresaId = getEmpresaId(req) || "unknown";
  return path.join(UPLOADS_ROOT, String(empresaId), String(ausenciaId));
}

// =========================
// CONTROLADORES
// =========================

// POST /empleado/ausencias/:id/adjuntos
export const subirAdjuntoEmpleado = async (req, res) => {
  try {
    const ausenciaId = req.params.id;

    const auth = await assertEmpleadoPuedeAccederAusencia({ ausenciaId, req });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "Archivo obligatorio" });

    // guardamos metadatos
    const rows = await sql`
      INSERT INTO ausencias_adjuntos_180 (
        ausencia_id, storage_path, filename, mime_type, size_bytes, creado_por
      ) VALUES (
        ${ausenciaId},
        ${file.path},
        ${file.originalname},
        ${file.mimetype},
        ${file.size},
        ${req.user.id}
      )
      RETURNING *
    `;

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, adjunto: rows[0] });
  } catch (err) {
    console.error("❌ subirAdjuntoEmpleado:", err);
    return res.status(500).json({ error: "Error subiendo adjunto" });
  }
};

// GET /empleado/ausencias/:id/adjuntos
export const listarAdjuntosEmpleado = async (req, res) => {
  try {
    const ausenciaId = req.params.id;

    const auth = await assertEmpleadoPuedeAccederAusencia({ ausenciaId, req });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

    const rows = await sql`
      SELECT id, ausencia_id, filename, mime_type, size_bytes, created_at, creado_por
      FROM ausencias_adjuntos_180
      WHERE ausencia_id = ${ausenciaId}
      ORDER BY created_at DESC
    `;

    // devolvemos también URL de descarga consistente (frontend la usa)
    const data = rows.map((r) => ({
      ...r,
      download_url: `/empleado/adjuntos/${r.id}/download`,
    }));

    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    console.error("❌ listarAdjuntosEmpleado:", err);
    return res.status(500).json({ error: "Error listando adjuntos" });
  }
};

// GET /empleado/adjuntos/:adjuntoId/download
export const descargarAdjunto = async (req, res) => {
  try {
    const { adjuntoId } = req.params;

    const auth = await assertPuedeAccederAdjunto({ adjuntoId, req });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

    const row = auth.row;
    const filePath = row.storage_path;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Archivo no disponible" });
    }

    // fuerza descarga (modal tendrá botón descargar)
    return res.download(filePath, row.filename || "adjunto");
  } catch (err) {
    console.error("❌ descargarAdjunto:", err);
    return res.status(500).json({ error: "Error descargando adjunto" });
  }
};

// DELETE /admin/adjuntos/:adjuntoId  (o /empleado/adjuntos/:adjuntoId si quieres permitir al uploader)
export const borrarAdjunto = async (req, res) => {
  try {
    const { adjuntoId } = req.params;

    const auth = await assertPuedeBorrarAdjunto({ adjuntoId, req });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

    const row = auth.row;

    // borrar fichero (si existe)
    if (row.storage_path) {
      try {
        await fsp.unlink(row.storage_path);
      } catch {
        // ignore (fichero ya borrado / no existe)
      }
    }

    await sql`
      DELETE FROM ausencias_adjuntos_180
      WHERE id = ${adjuntoId}
    `;

    res.set("Cache-Control", "no-store");
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ borrarAdjunto:", err);
    return res.status(500).json({ error: "Error borrando adjunto" });
  }
};

// GET /admin/ausencias/:id/adjuntos
export const listarAdjuntosAdmin = async (req, res) => {
  try {
    const ausenciaId = req.params.id;

    const auth = await assertAdminPuedeAccederAusencia({ ausenciaId, req });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

    const rows = await sql`
      SELECT id, ausencia_id, filename, mime_type, size_bytes, created_at, creado_por
      FROM ausencias_adjuntos_180
      WHERE ausencia_id = ${ausenciaId}
      ORDER BY created_at DESC
    `;

    const data = rows.map((r) => ({
      ...r,
      download_url: `/admin/adjuntos/${r.id}/download`,
    }));

    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    console.error("❌ listarAdjuntosAdmin:", err);
    return res.status(500).json({ error: "Error listando adjuntos" });
  }
};
