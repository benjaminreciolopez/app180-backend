const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const WEEKDAYS = [
  "lunes",
  "martes",
  "miércoles",
  "miercoles",
  "jueves",
  "viernes",
  "sábado",
  "sabado",
  "domingo",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeText(raw) {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLine(raw) {
  return normalizeText(raw)
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

function guessYearFromText(text) {
  // Coge el año más frecuente (por si el OCR repite encabezado)
  const matches = text.match(/\b(20\d{2})\b/g) || [];
  if (!matches.length) return new Date().getFullYear();

  const freq = new Map();
  for (const m of matches) freq.set(m, (freq.get(m) || 0) + 1);

  let best = matches[0];
  let bestN = 0;
  for (const [y, n] of freq.entries()) {
    if (n > bestN) {
      best = y;
      bestN = n;
    }
  }
  return Number(best);
}

function findMonthInLine(lineLower) {
  for (const [name, num] of Object.entries(MONTHS)) {
    // detecta "ABRIL", "ABRIL (..)", "Mes: abril", etc.
    if (
      lineLower === name ||
      lineLower.startsWith(name + " ") ||
      lineLower.includes(" " + name + " ") ||
      lineLower.endsWith(" " + name)
    ) {
      return num;
    }
  }
  return null;
}

function stripLeadingWeekday(lineLower) {
  // Quita "jueves 17 ..." o "jueves, 17 ..."
  const wd = WEEKDAYS.find((w) => lineLower.startsWith(w));
  if (!wd) return null;

  let rest = lineLower.slice(wd.length).trim();
  rest = rest.replace(/^[:,.-]\s*/g, "");
  return rest;
}

function classify(lineLower) {
  // Devuelve:
  // - tipo_db: (según tu CHECK)
  // - es_laborable
  // - subtipo (para label/descripcion)
  // - confidence (0..1)
  // - reason
  let subtipo = null;

  // Cierre empresa
  if (lineLower.includes("cierre") || lineLower.includes("cerrado")) {
    return {
      tipo_db: "cierre_empresa",
      es_laborable: false,
      subtipo: "cierre",
      confidence: 0.9,
      reason: "palabra_clave:cierre",
    };
  }

  // Laborable extra
  if (
    lineLower.includes("laborable") &&
    (lineLower.includes("extra") || lineLower.includes("adicional"))
  ) {
    return {
      tipo_db: "laborable_extra",
      es_laborable: true,
      subtipo: "laborable_extra",
      confidence: 0.85,
      reason: "palabra_clave:laborable_extra",
    };
  }

  // Convenio / ajuste
  if (
    lineLower.includes("convenio") ||
    lineLower.includes("ajuste") ||
    lineLower.includes("jornada") ||
    lineLower.includes("intensiva")
  ) {
    return {
      tipo_db: "convenio",
      es_laborable: true,
      subtipo: "convenio/ajuste",
      confidence: 0.75,
      reason: "palabra_clave:convenio_ajuste",
    };
  }

  // Festivos (nacional/autonómico/local)
  if (lineLower.includes("festivo") || lineLower.includes("fiesta")) {
    if (lineLower.includes("nacional")) subtipo = "nacional";
    else if (lineLower.includes("auton")) subtipo = "autonómico";
    else if (lineLower.includes("local") || lineLower.includes("municip"))
      subtipo = "local";

    return {
      // Limitación actual: tu DB solo tiene festivo_local
      // Guardamos el matiz en label/descripcion.
      tipo_db: "festivo_local",
      es_laborable: false,
      subtipo: subtipo || "festivo",
      confidence: 0.9,
      reason: "palabra_clave:festivo",
    };
  }

  // Heurística adicional: “Santo”, “Navidad”, etc. suele ser festivo
  const holidayHints = [
    "navidad",
    "año nuevo",
    "reyes",
    "viernes santo",
    "jueves santo",
    "domingo de resurrección",
    "lunes de pascua",
    "todos los santos",
    "constitución",
    "inmaculada",
    "trabajador",
  ];
  if (holidayHints.some((h) => lineLower.includes(h))) {
    return {
      tipo_db: "festivo_local",
      es_laborable: false,
      subtipo: "festivo",
      confidence: 0.7,
      reason: "heuristica:holiday_hint",
    };
  }

  // Default conservador: convenio (laborable) para no “matar” días por error
  return {
    tipo_db: "convenio",
    es_laborable: true,
    subtipo: "indeterminado",
    confidence: 0.35,
    reason: "fallback",
  };
}

function parseNumericDate(lineLower, currentYear, currentMonth) {
  // dd/mm[/yyyy] o dd-mm[-yyyy]
  // Ej: "17/04 festivo nacional"
  const m = lineLower.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\b/);
  if (!m) return null;

  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3] ? Number(m[3]) : currentYear;

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function parseDayWithMonthName(lineLower, currentYear, currentMonth) {
  // “16 abril”, “16 de abril”, “16-abril”, etc.
  // (si el mes no aparece, usa el currentMonth)
  const m = lineLower.match(/\b(\d{1,2})\s*(?:de\s*)?([a-záéíóú]+)?\b/i);
  if (!m) return null;

  const d = Number(m[1]);
  if (d < 1 || d > 31) return null;

  const maybeMonthName = (m[2] || "").toLowerCase();
  const foundMonth = MONTHS[maybeMonthName] || null;

  const mo = foundMonth || currentMonth;
  if (!mo) return null;

  return { y: currentYear, m: mo, d };
}

function parseRange(lineLower, currentYear, currentMonth) {
  // Rangos:
  // - “del 16 al 18”
  // - “del 16 de abril al 18 de abril”
  // - “16-18 abril”
  // Devuelve: { start:{y,m,d}, end:{y,m,d} } o null

  // del X al Y (con posible mes)
  let m = lineLower.match(
    /\bdel\s+(\d{1,2})(?:\s+de\s+([a-záéíóú]+))?\s+al\s+(\d{1,2})(?:\s+de\s+([a-záéíóú]+))?\b/i,
  );
  if (m) {
    const d1 = Number(m[1]);
    const mn1 = (m[2] || "").toLowerCase();
    const d2 = Number(m[3]);
    const mn2 = (m[4] || "").toLowerCase();

    const mo1 = MONTHS[mn1] || currentMonth;
    const mo2 = MONTHS[mn2] || MONTHS[mn1] || currentMonth;

    if (!mo1 || !mo2) return null;

    return {
      start: { y: currentYear, m: mo1, d: d1 },
      end: { y: currentYear, m: mo2, d: d2 },
    };
  }

  // 16-18 abril
  m = lineLower.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*([a-záéíóú]+)\b/i);
  if (m) {
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const mo = MONTHS[m[3].toLowerCase()] || currentMonth;
    if (!mo) return null;

    return {
      start: { y: currentYear, m: mo, d: d1 },
      end: { y: currentYear, m: mo, d: d2 },
    };
  }

  return null;
}

function expandRange(start, end) {
  // Expande rango día a día (mismo año, puede cruzar mes)
  const out = [];
  const dtStart = new Date(Date.UTC(start.y, start.m - 1, start.d));
  const dtEnd = new Date(Date.UTC(end.y, end.m - 1, end.d));
  if (Number.isNaN(dtStart.valueOf()) || Number.isNaN(dtEnd.valueOf()))
    return out;

  if (dtEnd < dtStart) return out;

  for (
    let d = new Date(dtStart);
    d <= dtEnd;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push({
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
    });
  }
  return out;
}

function buildDescripcion(originalLine, classified) {
  const base = originalLine.trim();
  if (!classified?.subtipo || classified.subtipo === "festivo") return base;

  // Etiqueta compacta que ayuda a filtrar en UI
  const tag =
    classified.subtipo === "nacional"
      ? "[NACIONAL]"
      : classified.subtipo === "autonómico"
        ? "[AUTONÓMICO]"
        : classified.subtipo === "local"
          ? "[LOCAL]"
          : classified.subtipo === "convenio/ajuste"
            ? "[CONVENIO]"
            : "";

  return tag ? `${tag} ${base}` : base;
}

/**
 * Devuelve items listos para tu DB (tipo_db, es_laborable, descripcion...)
 * + metadatos para debug/validación
 */
function parseLinesToItems(lines, defaultYear) {
  let currentMonth = null;
  let currentYear = defaultYear;

  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const line = normalizeLine(original);
    if (!line) continue;

    const lower = line.toLowerCase();

    // Mes por encabezado
    const monthFound = findMonthInLine(lower);
    if (monthFound) {
      currentMonth = monthFound;

      // Año en la misma línea (p.ej. "ABRIL 2025")
      const y = lower.match(/\b(20\d{2})\b/);
      if (y) currentYear = Number(y[1]);

      continue;
    }

    // Año suelto en línea
    const y2 = lower.match(/\b(20\d{2})\b/);
    if (y2) currentYear = Number(y2[1]);

    // Quitamos día de semana al inicio para facilitar parsing
    const stripped = stripLeadingWeekday(lower);
    const parseTarget = stripped || lower;

    // 1) Rango
    const range = parseRange(parseTarget, currentYear, currentMonth);
    if (range) {
      const c = classify(lower);
      const expanded = expandRange(range.start, range.end);
      for (const d of expanded) {
        items.push({
          fecha: toISODate(d.y, d.m, d.d),
          tipo: c.tipo_db,
          nombre: null,
          descripcion: buildDescripcion(line, c),
          es_laborable: c.es_laborable,
          label: c.subtipo || null,
          activo: true,
          meta: {
            confidence: c.confidence,
            reason: c.reason,
            source_line: line,
            line_no: i + 1,
            detected_month: currentMonth,
            detected_year: currentYear,
            is_range: true,
          },
        });
      }
      continue;
    }

    // 2) Fecha numérica dd/mm
    const nd = parseNumericDate(parseTarget, currentYear, currentMonth);
    if (nd) {
      const c = classify(lower);
      items.push({
        fecha: toISODate(nd.y, nd.m, nd.d),
        tipo: c.tipo_db,
        nombre: null,
        descripcion: buildDescripcion(line, c),
        es_laborable: c.es_laborable,
        label: c.subtipo || null,
        activo: true,
        meta: {
          confidence: c.confidence,
          reason: c.reason,
          source_line: line,
          line_no: i + 1,
          detected_month: currentMonth,
          detected_year: currentYear,
          is_range: false,
        },
      });
      continue;
    }

    // 3) Día + mes (o usa currentMonth)
    const dm = parseDayWithMonthName(parseTarget, currentYear, currentMonth);
    if (dm) {
      // Para evitar falsos positivos, exige que el documento tenga contexto de mes
      // o que la línea contenga keywords relevantes (festivo/convenio/cierre/laborable)
      const hasContextMonth = !!currentMonth;
      const hasKeywords =
        lower.includes("festivo") ||
        lower.includes("convenio") ||
        lower.includes("ajuste") ||
        lower.includes("cierre") ||
        lower.includes("laborable") ||
        lower.includes("fiesta");

      if (!hasContextMonth && !hasKeywords) continue;

      const c = classify(lower);
      items.push({
        fecha: toISODate(dm.y, dm.m, dm.d),
        tipo: c.tipo_db,
        nombre: null,
        descripcion: buildDescripcion(line, c),
        es_laborable: c.es_laborable,
        label: c.subtipo || null,
        activo: true,
        meta: {
          confidence: c.confidence,
          reason: c.reason,
          source_line: line,
          line_no: i + 1,
          detected_month: currentMonth,
          detected_year: currentYear,
          is_range: false,
        },
      });
    }
  }

  return items;
}

function dedupeByEmpresaFecha(items) {
  // Dedup por fecha: si hay colisión, preferimos:
  // - mayor confidence
  // - si empate, preferimos festivo/cierre sobre convenio
  const rankTipo = (t) =>
    t === "cierre_empresa"
      ? 4
      : t === "festivo_local"
        ? 3
        : t === "laborable_extra"
          ? 2
          : 1;

  const map = new Map();
  for (const it of items) {
    const key = it.fecha;
    if (!map.has(key)) {
      map.set(key, it);
      continue;
    }

    const prev = map.get(key);
    const pc = prev.meta?.confidence ?? 0;
    const nc = it.meta?.confidence ?? 0;

    if (nc > pc) {
      map.set(key, it);
      continue;
    }
    if (nc === pc && rankTipo(it.tipo) > rankTipo(prev.tipo)) {
      map.set(key, it);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  );
}

/**
 * API pública: recibe raw OCR text, devuelve preview listo para UI/DB
 */
export function parseCalendarioLaboralV2(rawText) {
  const text = normalizeText(rawText || "");
  const defaultYear = guessYearFromText(text);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = parseLinesToItems(lines, defaultYear);
  const out = dedupeByEmpresaFecha(items);

  return out;
}
