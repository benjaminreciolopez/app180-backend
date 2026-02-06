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

const OCR_FIXES = [
  // errores típicos del documento que has pegado
  [/\btaborables\b/gi, "laborables"],
  [/\bconvento\b/gi, "convenio"],
  [/\bTed(os)?\b/gi, "Todos"],
  [/\blocaliclad\b/gi, "localidad"],
  [/\bfimantes\b/gi, "firmantes"],
  [/\bmantenimiento\b/gi, "manteniendo"],
  // ruido frecuente
  [/[\u2014\u2013]/g, "-"], // em dash / en dash
];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeRaw(text) {
  let t = String(text || "");
  for (const [re, rep] of OCR_FIXES) t = t.replace(re, rep);

  // normaliza espacios y caracteres raros
  t = t
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n");

  return t;
}

function cleanLine(line) {
  // elimina basura típica OCR (flechas, símbolos sueltos, repeticiones)
  let s = (line || "").trim();

  // corta colas de ruido tipo " > »", " í » A", "—", letras sueltas
  s = s.replace(/\s*[>»]+.*$/g, "");
  s = s.replace(/\s*[íÍ]\s*»\s*[A-Z]\s*$/g, "");
  s = s.replace(/\s*[A-Z]\s*$/g, (m) => (m.length <= 2 ? "" : m)); // suelta 1 letra final
  s = s.replace(/\s*[-=]{2,}\s*$/g, "");
  s = s.replace(/\s+/g, " ").trim();

  // filtra líneas casi vacías o puro ruido
  if (s.length < 4) return "";
  if (/^[\-\=\>\.\,\s]+$/.test(s)) return "";
  return s;
}

function guessYear(text) {
  const m = text.match(/\b(20\d{2})\b/g) || [];
  if (!m.length) return new Date().getFullYear();
  // mayor frecuencia
  const freq = new Map();
  for (const y of m) freq.set(y, (freq.get(y) || 0) + 1);
  let best = m[0],
    bestN = 0;
  for (const [y, n] of freq.entries()) {
    if (n > bestN) {
      best = y;
      bestN = n;
    }
  }
  return Number(best);
}

function findMonthHeader(lineLower) {
  // Ej: "ENERO (19 días laborables). -"
  for (const [name, num] of Object.entries(MONTHS)) {
    if (lineLower.startsWith(name)) return num;
  }
  return null;
}

function isStopSection(lineLower) {
  // A partir de aquí NO queremos parsear fechas como eventos
  return (
    lineLower.startsWith("(*)") ||
    lineLower.includes("acuerdo de jornada") ||
    lineLower.includes("este calendario es de aplicación") ||
    lineLower.includes("las partes firmantes") ||
    lineLower.includes("jornada de 1736") ||
    lineLower.includes("u.g.t.") ||
    lineLower.includes("informa")
  );
}

function parseDayLine(line) {
  // formatos esperados:
  // "Miércoles 1 Día de año Nuevo (Fiesta Nacional)"
  // "Jueves 2 Festivo local *"
  // "Viernes 3 Ajuste de convenio"
  // "Miércoles 16 - Ajuste de convenio (Miércoles Santo)"
  const lower = line.toLowerCase();

  const wd = WEEKDAYS.find((w) => lower.startsWith(w));
  if (!wd) return null;

  // extrae número del día justo después
  const rest = lower
    .slice(wd.length)
    .trim()
    .replace(/^[:,.-]\s*/g, "");
  const m = rest.match(/^(\d{1,2})\b/);
  if (!m) return null;

  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;

  // descripción original sin el prefijo "Miércoles 16"
  const desc = line
    .replace(new RegExp(`^\\s*${wd}\\s+\\d{1,2}\\s*[-:.,]?\\s*`, "i"), "")
    .trim();

  return { day, desc };
}

function classify(descOriginal) {
  const d = descOriginal.toLowerCase();

  // subtipo label para festivos
  let label = null;
  if (
    d.includes("fiesta nacional") ||
    d.includes("festivo nacional") ||
    d.includes("nacional")
  )
    label = "nacional";
  else if (d.includes("auton")) label = "autonómico";
  else if (d.includes("local")) label = "local";

  // tipo DB + laborable
  if (d.includes("cierre") || d.includes("cerrado")) {
    return {
      tipo: "cierre_empresa",
      es_laborable: false,
      label: "cierre",
      confidence: 0.9,
      reason: "keyword:cierre",
    };
  }

  if (
    d.includes("laborable") &&
    (d.includes("extra") || d.includes("adicional"))
  ) {
    return {
      tipo: "laborable_extra",
      es_laborable: true,
      label: "extra",
      confidence: 0.85,
      reason: "keyword:laborable_extra",
    };
  }

  if (d.includes("ajuste") || d.includes("convenio") || d.includes("jornada")) {
    // Aunque el OCR ponga "Ajuste de convento", ya lo corregimos en normalizeRaw
    return {
      tipo: "convenio",
      es_laborable: true,
      label: "convenio",
      confidence: 0.8,
      reason: "keyword:convenio_ajuste",
    };
  }

  if (d.includes("festivo") || d.includes("fiesta") || d.includes("día de")) {
    // “Día del Trabajo”, “Navidad”… suelen ser festivos aunque no diga “festivo”
    return {
      tipo: "festivo_local",
      es_laborable: false,
      label: label || "festivo",
      confidence: label ? 0.95 : 0.75,
      reason: label ? "festivo:subtipo" : "festivo:heuristica",
    };
  }

  // fallback conservador
  return {
    tipo: "convenio",
    es_laborable: true,
    label: "indeterminado",
    confidence: 0.35,
    reason: "fallback",
  };
}

function buildDescripcion(descOriginal, cls) {
  // Limpieza final: quita asteriscos sueltos y dobles espacios
  let s = (descOriginal || "").replace(/\*/g, "").replace(/\s+/g, " ").trim();

  // Si es festivo y label nacional/autonómico/local, lo dejamos visible en label (columna)
  // No hace falta ensuciar descripción con tags, pero sí la dejamos humana.
  // Opcional: si quieres tags visibles, se podrían añadir.
  return s || null;
}

function dedupe(items) {
  // si se repite un día, elige mayor confidence; a empate, prioriza festivo/cierre
  const rank = (t) =>
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

    if (nc > pc) map.set(key, it);
    else if (nc === pc && rank(it.tipo) > rank(prev.tipo)) map.set(key, it);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  );
}

export function parseCalendarioLaboralV3(rawText) {
  const normalized = normalizeRaw(rawText);
  const year = guessYear(normalized);

  const lines = normalized.split(/\r?\n/).map(cleanLine).filter(Boolean);

  let currentMonth = null;
  let parsingEvents = false;

  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Stop sections (bloques informativos)
    if (isStopSection(lower)) {
      // ojo: "U.G.T. INFORMA" aparece al principio también.
      // solo cortamos parsing si ya habíamos empezado con meses.
      if (parsingEvents) break;
      continue;
    }

    // Mes header
    const mh = findMonthHeader(lower);
    if (mh) {
      currentMonth = mh;
      parsingEvents = true;
      continue;
    }

    if (!currentMonth) continue; // no parsear nada hasta detectar un mes

    // Intentar parsear línea de evento
    const parsed = parseDayLine(line);
    if (!parsed) continue;

    const cls = classify(parsed.desc);
    const descripcion = buildDescripcion(parsed.desc, cls);

    const fecha = toISODate(year, currentMonth, parsed.day);

    items.push({
      fecha,
      tipo: cls.tipo,
      nombre: null,
      descripcion,
      es_laborable: cls.es_laborable,
      label:
        cls.tipo === "festivo_local"
          ? cls.label || "festivo"
          : cls.label || null,
      activo: true,
      meta: {
        confidence: cls.confidence,
        reason: cls.reason,
        source_line: line,
        line_no: i + 1,
        year,
        month: currentMonth,
      },
    });
  }

  return dedupe(items);
}
