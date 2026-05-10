// backend/src/services/csvImportService.js
//
// Utilidades de parseo de hojas de cálculo (CSV / XLSX) para importaciones
// masivas (clientes, facturas, gastos, etc.). Soporta:
//   - CSV con separadores ; , \t y campos entrecomillados (RFC 4180-light)
//   - XLSX (Excel moderno) vía exceljs (ya en dependencias del proyecto)
//   - Formato de números español (1.234,56) y anglosajón (1234.56)
//   - Fechas DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, y Date object de Excel
//
// API principal:
//   - parseSpreadsheet(buffer, filename, mimetype) → { headers, rows }
//   - parseCsv(text) (legacy / uso directo)
//
// Devuelve `{ headers, rows }` donde rows es un array de objetos por fila.

import ExcelJS from "exceljs";

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
 * Parsea un Excel .xlsx desde un buffer. Toma la primera hoja con datos.
 * Devuelve { headers, rows } con el mismo contrato que parseCsv:
 *   - headers: array de strings en minúscula y trim.
 *   - rows: array de objetos con keys = headers.
 *   - cada fila incluye __line con el número de fila origen (1-based).
 */
export async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find((w) => w.rowCount > 0) || workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.text || "").toLowerCase().trim();
  });
  // Rellenar huecos con strings vacías
  for (let i = 0; i < headers.length; i++) if (!headers[i]) headers[i] = "";

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj = {};
    let empty = true;
    for (let c = 1; c <= headers.length; c++) {
      const h = headers[c - 1];
      if (!h) continue;
      const cell = row.getCell(c);
      let val = "";
      const v = cell.value;
      if (v == null) {
        val = "";
      } else if (v instanceof Date) {
        // Excel guarda fechas como Date; convertimos a DD/MM/YYYY (parseFecha lo soporta)
        const d = v;
        val = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      } else if (typeof v === "object" && v !== null) {
        // Fórmulas: { result, formula }
        if ("result" in v) val = String(v.result ?? "");
        else if ("text" in v) val = String(v.text ?? "");
        else if ("richText" in v && Array.isArray(v.richText)) {
          val = v.richText.map((rt) => rt.text || "").join("");
        } else {
          val = cell.text || "";
        }
      } else {
        val = String(v);
      }
      obj[h] = val.trim();
      if (val !== "") empty = false;
    }
    if (!empty) {
      obj.__line = r;
      rows.push(obj);
    }
  }
  return { headers: headers.filter(Boolean), rows };
}

/**
 * Detecta tipo de archivo por extensión + mimetype y delega al parser
 * adecuado. Buffer puede ser CSV (texto) o XLSX (binario).
 */
export async function parseSpreadsheet(buffer, filename = "", mimetype = "") {
  const lower = (filename || "").toLowerCase();
  const isXlsx =
    lower.endsWith(".xlsx") ||
    mimetype.includes("spreadsheetml") ||
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const isXlsLegacy = lower.endsWith(".xls") && !isXlsx;

  if (isXlsLegacy) {
    const e = new Error(
      "Formato .xls antiguo (Excel 97-2003) no soportado. Guárdalo como .xlsx o .csv y vuelve a subirlo."
    );
    e.status = 400;
    throw e;
  }

  if (isXlsx) {
    return await parseXlsx(buffer);
  }

  // Fallback CSV (texto). Probamos UTF-8 y, si trae caracteres raros, latin1.
  let text = buffer.toString("utf8");
  // Heurístico: si no hay separadores típicos pero buffer tiene contenido,
  // intentamos latin1 (común en exports de software español antiguo).
  if (text && !/[;,\t\n]/.test(text.slice(0, 200))) {
    text = buffer.toString("latin1");
  }
  return parseCsv(text);
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
