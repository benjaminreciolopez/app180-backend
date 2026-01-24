// backend/src/services/festivosNagerService.js

import { sql } from "../db.js";

const NAGER_BASE = "https://date.nager.at/api/v3";

function normalizeText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function classifyAmbito(nagerItem) {
  // Nager suele traer "counties": null | [] | ["ES-AN", ...]
  const counties = Array.isArray(nagerItem?.counties)
    ? nagerItem.counties
    : null;

  if (!counties || counties.length === 0) return "nacional";
  // MVP: lo guardamos como "autonomico" aunque técnicamente son subdivisiones (comunidad/provincia)
  return "autonomico";
}

function extractComunidad(nagerItem) {
  const counties = Array.isArray(nagerItem?.counties)
    ? nagerItem.counties
    : null;
  if (!counties || counties.length === 0) return null;

  // Guardamos tal cual (CSV) para futura lógica por comunidad/provincia
  // Ej: "ES-AN,ES-MD"
  return counties.join(",");
}

/**
 * Descarga festivos ES para un año (Nager.Date).
 * Devuelve array normalizado a tu esquema festivos_es_180.
 */
export async function fetchFestivosES(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error("Year inválido");
  }

  const url = `${NAGER_BASE}/PublicHolidays/${y}/ES`;
  const r = await fetch(url, { headers: { accept: "application/json" } });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Nager.Date error ${r.status}: ${txt || r.statusText}`);
  }

  const data = await r.json();
  if (!Array.isArray(data)) return [];

  return data
    .map((it) => {
      const fecha = normalizeText(it?.date); // "YYYY-MM-DD"
      if (!fecha) return null;

      const nombre =
        normalizeText(it?.localName) || normalizeText(it?.name) || "Festivo";

      return {
        fecha,
        nombre,
        ambito: classifyAmbito(it), // "nacional" | "autonomico"
        comunidad: extractComunidad(it), // CSV o null
        provincia: null,
        municipio: null,
      };
    })
    .filter(Boolean);
}

/**
 * Upsert en festivos_es_180:
 * - Clave: fecha
 * - Actualiza nombre/ambito/comunidad/provincia/municipio
 * - No borra nada
 */
export async function upsertFestivosES(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted_or_updated: 0 };
  }

  let count = 0;

  for (const r of rows) {
    if (typeof r.fecha !== "string") {
      throw new Error("Fecha inválida en festivos");
    }

    await sql`
      INSERT INTO festivos_es_180
        (fecha, nombre, ambito, comunidad, provincia, municipio)
      VALUES
        (
          ${r.fecha},
          ${r.nombre},
          ${r.ambito},
          ${r.comunidad},
          ${r.provincia},
          ${r.municipio}
        )
      ON CONFLICT (fecha) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        ambito = EXCLUDED.ambito,
        comunidad = EXCLUDED.comunidad,
        provincia = EXCLUDED.provincia,
        municipio = EXCLUDED.municipio
    `;

    count++;
  }

  return { inserted_or_updated: count };
}

/**
 * Asegura que existan festivos del año dado:
 * - Si ya hay para ese año, no hace nada.
 * - Si no hay, descarga e inserta.
 */
export async function ensureFestivosForYear(year) {
  const y = Number(year);

  const exists = await sql`
    SELECT 1
    FROM festivos_es_180
    WHERE EXTRACT(YEAR FROM fecha) = ${y}
    LIMIT 1
  `;

  if (exists.length) {
    return { ok: true, imported: false, year: y, count: 0 };
  }

  const rows = await fetchFestivosES(y);
  const up = await upsertFestivosES(rows);

  return { ok: true, imported: true, year: y, count: up.inserted_or_updated };
}
// backend/src/controllers/fichajeEstadoController.js
