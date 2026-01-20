import { sql } from "../db.js";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";
import { parseCalendarioLaboralV2 } from "../services/ocr/calendarioParser.v2.js";

/**
 * Obtén empresa_id desde user admin (ajusta si ya tienes helper)
 */
async function getEmpresaIdAdminOrThrow(userId) {
  const r =
    await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  const empresaId = r[0]?.id ?? null;
  if (!empresaId) {
    const err = new Error("Empresa no asociada al usuario");
    err.status = 403;
    throw err;
  }
  return empresaId;
}

/**
 * POST /admin/calendario/ocr/preview
 * multipart/form-data: file
 */
export async function importarPreviewOCR(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Falta archivo (file)" });
    }

    const text = await ocrExtractTextFromUpload(req.file);
    const preview = parseCalendarioLaboralV2(text);

    return res.json({
      ok: true,
      raw_text: text,
      preview,
    });
  } catch (e) {
    console.error("[ocr/preview] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error OCR" });
  }
}

/**
 * POST /admin/calendario/ocr/confirmar
 * body: { items: [{fecha, tipo, nombre, descripcion, es_laborable, label, activo}] }
 */
export async function confirmarOCR(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No auth" });

    const empresaId = await getEmpresaIdAdminOrThrow(userId);

    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

    // Normalización mínima + protección
    const clean = items
      .map((it) => ({
        fecha: it.fecha,
        tipo: it.tipo,
        nombre: it.nombre ?? null,
        descripcion: it.descripcion ?? null,
        es_laborable: !!it.es_laborable,
        label: it.label ?? null,
        activo: it.activo !== false,
      }))
      .filter(
        (it) => typeof it.fecha === "string" && typeof it.tipo === "string",
      );

    if (clean.length === 0) {
      return res.status(400).json({ error: "items inválidos" });
    }

    // UPSERT por (empresa_id, fecha)
    // Si existe, actualiza. Si no, inserta.
    // Importante: origen='ocr', confirmado=true, creado_por=userId
    await sql.begin(async (tx) => {
      for (const it of clean) {
        await tx`
          insert into calendario_empresa_180
            (empresa_id, fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen, confirmado, creado_por)
          values
            (${empresaId}, ${it.fecha}::date, ${it.tipo}, ${it.nombre}, ${it.descripcion}, ${it.es_laborable}, ${it.label}, ${it.activo}, 'ocr', true, ${userId})
          on conflict (empresa_id, fecha)
          do update set
            tipo = excluded.tipo,
            nombre = excluded.nombre,
            descripcion = excluded.descripcion,
            es_laborable = excluded.es_laborable,
            label = excluded.label,
            activo = excluded.activo,
            origen = 'ocr',
            confirmado = true,
            actualizado_por = null,
            updated_at = now()
        `;
      }
    });

    return res.json({ ok: true, inserted_or_updated: clean.length });
  } catch (e) {
    console.error("[ocr/confirmar] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error confirmación OCR" });
  }
}
