import { sql } from "../db.js";
import { seedKnowledge } from "../services/knowledgeSeedService.js";

async function getEmpresaId(userId) {
  const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

/**
 * GET /admin/conocimiento
 */
export async function listar(req, res) {
  try {
    const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
    const rows = await sql`
      SELECT id, token, respuesta, categoria, prioridad, activo, created_at, updated_at
      FROM conocimiento_180
      WHERE empresa_id = ${empresaId}
      ORDER BY prioridad DESC, token ASC
    `;
    res.json(rows);
  } catch (err) {
    console.error("[Knowledge] Error listar:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * POST /admin/conocimiento
 */
export async function crear(req, res) {
  try {
    const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
    const { token, respuesta, categoria, prioridad } = req.body;

    if (!token || !respuesta) {
      return res.status(400).json({ error: "Token y respuesta son requeridos" });
    }

    const existe = await sql`
      SELECT 1 FROM conocimiento_180
      WHERE empresa_id = ${empresaId} AND LOWER(token) = LOWER(${token.trim()})
    `;
    if (existe[0]) {
      return res.status(400).json({ error: "Ya existe un token con esa palabra clave" });
    }

    const r = await sql`
      INSERT INTO conocimiento_180 (empresa_id, token, respuesta, categoria, prioridad)
      VALUES (${empresaId}, ${token.trim()}, ${respuesta.trim()}, ${categoria || null}, ${prioridad || 0})
      RETURNING *
    `;
    res.status(201).json(r[0]);
  } catch (err) {
    console.error("[Knowledge] Error crear:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * PATCH /admin/conocimiento/:id
 */
export async function actualizar(req, res) {
  try {
    const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
    const { id } = req.params;
    const { token, respuesta, categoria, prioridad, activo } = req.body;

    const fields = {};
    if (token !== undefined) fields.token = token.trim();
    if (respuesta !== undefined) fields.respuesta = respuesta.trim();
    if (categoria !== undefined) fields.categoria = categoria || null;
    if (prioridad !== undefined) fields.prioridad = prioridad;
    if (activo !== undefined) fields.activo = activo;
    fields.updated_at = new Date();

    if (Object.keys(fields).length <= 1) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const r = await sql`
      UPDATE conocimiento_180
      SET ${sql(fields)}
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING *
    `;
    if (!r[0]) return res.status(404).json({ error: "No encontrado" });
    res.json(r[0]);
  } catch (err) {
    console.error("[Knowledge] Error actualizar:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * DELETE /admin/conocimiento/:id
 */
export async function eliminar(req, res) {
  try {
    const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
    const { id } = req.params;

    const r = await sql`
      DELETE FROM conocimiento_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
      RETURNING id
    `;
    if (!r[0]) return res.status(404).json({ error: "No encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Knowledge] Error eliminar:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * POST /admin/conocimiento/seed
 */
export async function recargarSemilla(req, res) {
  try {
    const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
    await seedKnowledge(empresaId);
    res.json({ success: true, message: "Base de conocimiento actualizada con funciones de la app" });
  } catch (err) {
    console.error("[Knowledge] Error recargarSemilla:", err);
    res.status(500).json({ error: "Error al recargar conocimiento base" });
  }
}
