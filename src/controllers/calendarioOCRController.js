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

    const items = req.body?.items;
    const raw_text =
      typeof req.body?.raw_text === "string" ? req.body.raw_text : null;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

    const clean = items
      .map((it) => ({
        fecha: it.fecha,
        tipo: it.tipo,
        nombre: null,
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

    // stats
    const stats = {
      total: clean.length,
      activos: clean.filter((x) => x.activo).length,
      festivos: clean.filter((x) => x.tipo === "festivo_local").length,
      convenios: clean.filter((x) => x.tipo === "convenio").length,
      cierres: clean.filter((x) => x.tipo === "cierre_empresa").length,
      extras: clean.filter((x) => x.tipo === "laborable_extra").length,
      manuales: clean.filter((x) => x.origen === "manual").length,
      ocr: clean.filter((x) => x.origen === "ocr").length,
    };

    const origenGlobal =
      stats.manuales === 0 ? "ocr" : stats.ocr === 0 ? "manual" : "mixto";

    const result = await sql.begin(async (tx) => {
      // 1) crear importación
      const ins = await tx`
        insert into calendario_importacion_180 (empresa_id, creado_por, origen, raw_text, stats)
        values (${empresaId}, ${userId}, ${origenGlobal}, ${raw_text}, ${stats}::jsonb)
        returning id
      `;
      const importacionId = ins[0].id;

      // 2) snapshot items
      for (const it of clean) {
        await tx`
          insert into calendario_importacion_item_180
            (importacion_id, empresa_id, fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen)
          values
            (${importacionId}, ${empresaId}, ${it.fecha}::date, ${it.tipo}, ${it.nombre}, ${it.descripcion}, ${it.es_laborable}, ${it.label}, ${it.activo}, ${it.origen})
          on conflict (importacion_id, fecha)
          do update set
            tipo = excluded.tipo,
            nombre = excluded.nombre,
            descripcion = excluded.descripcion,
            es_laborable = excluded.es_laborable,
            label = excluded.label,
            activo = excluded.activo,
            origen = excluded.origen
        `;
      }

      // 3) aplicar a calendario_empresa_180
      for (const it of clean) {
        await tx`
          insert into calendario_empresa_180
            (empresa_id, fecha, tipo, nombre, descripcion, es_laborable, label, activo, origen, confirmado, creado_por, importacion_id)
          values
            (${empresaId}, ${it.fecha}::date, ${it.tipo}, ${it.nombre}, ${it.descripcion}, ${it.es_laborable}, ${it.label}, ${it.activo}, ${it.origen}, true, ${userId}, ${importacionId})
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
            importacion_id = excluded.importacion_id,
            updated_at = now()
        `;
      }

      return { importacionId };
    });

    return res.json({
      ok: true,
      importacion_id: result.importacionId,
      stats,
    });
  } catch (e) {
    console.error("[ocr/confirmar] error:", e);
    return res
      .status(e.status || 500)
      .json({ error: e.message || "Error confirmación OCR" });
  }
}
