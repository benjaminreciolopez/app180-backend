// backend/src/services/csvImportService.js
//
// Utilidades de parseo CSV/TSV para importaciones masivas (clientes, facturas,
// gastos, etc.). Implementación local, sin dependencias adicionales — soporta:
//   - Separadores ; , \t
//   - Cabecera obligatoria en primera línea
//   - Campos entrecomillados con " (RFC 4180-light)
//   - Formato de números español (1.234,56) y anglosajón (1234.56)
//   - Fechas DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
//
// Devuelve `{ headers, rows }` donde rows es un array de objetos por fila.

/**
 * Detecta el separador más probable (;, , \t).
 */
function detectarSeparador(linea) {
  const candidatos = [";", "\t", ","];
  let best = ";";
  let max = -1;
  for (const c of candidatos) {
    const n = (linea.match(new RegExp(`\\${c}`, "g")) || []).length;
    if (n > max) { max = n; best = c; }
  }
  return best;
}

/**
 * Parser RFC4180-light de una línea CSV con un separador dado.
 */
function parseLine(line, sep) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === sep) { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parsea texto CSV completo. Devuelve { headers, rows }.
 */
export function parseCsv(text) {
  if (!text || typeof text !== "string") return { headers: [], rows: [] };
  // Normalizar EOL
  const lineas = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lineas.length === 0) return { headers: [], rows: [] };
  const sep = detectarSeparador(lineas[0]);
  const headers = parseLine(lineas[0], sep).map((h) => h.toLowerCase().trim());
  const rows = [];
  for (let i = 1; i < lineas.length; i++) {
    const cols = parseLine(lineas[i], sep);
    if (cols.length === 1 && cols[0] === "") continue; // línea vacía
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] !== undefined ? cols[idx] : ""; });
    obj.__line = i + 1;
    rows.push(obj);
  }
  return { headers, rows, sep };
}

/**
 * Convierte un string numérico tolerando formatos español/inglés.
 *   "1.234,56" → 1234.56
 *   "1234.56"  → 1234.56
 *   ""         → null
 */
export function parseNumero(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  // Si tiene coma decimal española
  if (/,\d{1,2}$/.test(s)) {
    const limpio = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(limpio);
    return isNaN(n) ? null : n;
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Convierte una fecha tolerando varios formatos. Devuelve YYYY-MM-DD o null.
 */
export function parseFecha(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  // YYYY-MM-DD o YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  // DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Booleano tolerante: "si"/"sí"/"true"/"1" → true; "no"/"false"/"0" → false.
 */
export function parseBool(val) {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  if (!s) return null;
  if (["si", "sí", "true", "1", "yes", "y"].includes(s)) return true;
  if (["no", "false", "0", "n"].includes(s)) return false;
  return null;
}

/**
 * Detecta serie a partir de un número de factura.
 *   "2026/A/00027" → "2026/A"
 *   "A-2026-27"    → "A-2026"
 *   "F2026-027"    → "F2026"
 *   "27"           → ""
 */
export function detectarSerie(numeroFactura) {
  if (!numeroFactura) return "";
  const s = String(numeroFactura).trim();
  // Quitar el último bloque numérico si hay separadores
  const partes = s.split(/[\/\-_]/);
  if (partes.length <= 1) return "";
  // El último elemento es el correlativo si es solo dígitos
  if (/^\d+$/.test(partes[partes.length - 1])) {
    return partes.slice(0, -1).join("/");
  }
  return "";
}
