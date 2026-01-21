import { sql } from "../db.js";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";
import { parseCalendarioLaboralV3 } from "../services/ocr/calendarioParser.v3.js";

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

export async function importarPreviewOCR(req, res) {
  try {
    const files = req.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Faltan archivos (files[])" });
    }

    let fullText = "";
    for (const f of files) {
      const t = await ocrExtractTextFromUpload(f);
      if (t) fullText += "\n" + t;
    }
    fullText = fullText.trim();

    const preview = parseCalendarioLaboralV3(fullText);

    return res.json({
      ok: true,
      raw_text: fullText,
      preview,
      pages: files.length,
    });
  } catch (e) {
    console.error("[ocr/preview] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error OCR" });
  }
}

export async function reparseOCR(req, res) {
  try {
    const raw = req.body?.raw_text;
    if (typeof raw !== "string" || raw.trim().length < 20) {
      return res.status(400).json({ error: "raw_text vacío o inválido" });
    }

    const preview = parseCalendarioLaboralV3(raw);

    return res.json({
      ok: true,
      preview,
    });
  } catch (e) {
    console.error("[ocr/reparse] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error reparse" });
  }
}

export async function confirmarOCR(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No auth" });

    const empresaId = await getEmpresaIdAdminOrThrow(userId);
    const origen = it.origen === "manual" ? "manual" : "ocr";

    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

    // Solo lo que tu tabla necesita. Ignoramos meta.
    const clean = items
      .map((it) => ({
        fecha: it.fecha,
        tipo: it.tipo,
        nombre: it.nombre ?? null,
        descripcion: it.descripcion ?? null,
        es_laborable: !!it.es_laborable,
        label: it.label ?? null,
        activo: it.activo !== false,
        origen: it.origen === "manual" ? "manual" : "ocr",
      }))
      .filter(
        (it) => typeof it.fecha === "string" && typeof it.tipo === "string",
      );

    if (clean.length === 0) {
      return res.status(400).json({ error: "items inválidos" });
    }

    await sql.begin(async (tx) => {
      for (const it of clean) {
        await tx`
          insert into calendario_empresa_180
            (empresa_id, fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen, confirmado, creado_por)
          values
            (${empresaId}, ${it.fecha}::date, ${it.tipo}, ${it.nombre}, ${it.descripcion}, ${it.es_laborable}, ${it.label}, ${it.activo}, ${origen}, true, ${userId})
          on conflict (empresa_id, fecha)
          do update set
            tipo = excluded.tipo,
            nombre = excluded.nombre,
            descripcion = excluded.descripcion,
            es_laborable = excluded.es_laborable,
            label = excluded.label,
            activo = excluded.activo,
            origen = excluded.origen,
            confirmado = true,
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
