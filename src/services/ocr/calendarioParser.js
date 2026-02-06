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

function guessYear(text) {
  // Busca "2025" etc
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeLine(s) {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[()]/g, (m) => m) // mantiene paréntesis
    .replace(/\s+/g, " ")
    .trim();
}

function detectTipo(line) {
  const l = line.toLowerCase();

  if (l.includes("cierre"))
    return { tipo: "cierre_empresa", es_laborable: false };

  if (l.includes("laborable"))
    return { tipo: "laborable_extra", es_laborable: true };

  if (l.includes("ajuste") || l.includes("convenio"))
    return { tipo: "convenio", es_laborable: true };

  // En tu tabla solo existe festivo_local, pero podemos mapear todo a festivo_local
  // o ampliar tipos en DB si quieres nacional/autonómico.
  if (l.includes("festivo"))
    return { tipo: "festivo_local", es_laborable: false };

  // fallback: convenio
  return { tipo: "convenio", es_laborable: true };
}

function extractDayNumber(line) {
  // Busca un número de día 1..31 después de un nombre de día o al inicio
  // Ej: "Jueves 17 ..." -> 17
  // Ej: "Sábado 1 ..." -> 1
  const m = line.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const d = Number(m[1]);
  if (d < 1 || d > 31) return null;
  return d;
}

export function parseCalendarioLaboral(rawText) {
  const year = guessYear(rawText);
  const lines = rawText.split("\n").map(normalizeLine).filter(Boolean);

  let currentMonth = null;
  const out = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Detecta meses en líneas tipo "ABRIL (19 días laborables)" o "ABRIL"
    for (const [name, mnum] of Object.entries(MONTHS)) {
      if (lower.startsWith(name)) {
        currentMonth = mnum;
        break;
      }
    }

    // Si no hay mes activo, no parseamos fechas
    if (!currentMonth) continue;

    // Detecta líneas de eventos: normalmente contienen un día numérico
    const day = extractDayNumber(line);
    if (!day) continue;

    const { tipo, es_laborable } = detectTipo(line);

    // Descripción: quita "Lunes 3" o similar del inicio
    const desc = line
      .replace(
        /^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+\d{1,2}\s*/i,
        "",
      )
      .trim();

    out.push({
      fecha: toISODate(year, currentMonth, day),
      tipo,
      nombre: null,
      descripcion: desc || null,
      es_laborable,
      label: null,
      activo: true,
    });
  }

  // Dedup por fecha (si el OCR repite)
  const byDate = new Map();
  for (const it of out) byDate.set(it.fecha, it);
  return Array.from(byDate.values()).sort((a, b) =>
    a.fecha.localeCompare(b.fecha),
  );
}
