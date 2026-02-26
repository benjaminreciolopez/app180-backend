// backend/src/services/extractoBancarioService.js
import { sql } from "../db.js";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/**
 * Parsea un extracto bancario desde un buffer (CSV, Excel, OFX).
 * Devuelve un array normalizado de movimientos.
 *
 * @param {Buffer} buffer
 * @param {string} filename - nombre original del archivo
 * @returns {Array<{fecha: string, concepto: string, importe: number, referencia?: string}>}
 */
export async function parsearExtracto(buffer, filename) {
  const ext = (filename || "").toLowerCase();

  if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
    return parsearExcel(buffer);
  } else if (ext.endsWith(".ofx") || ext.endsWith(".qfx")) {
    return parsearOFX(buffer.toString("utf-8"));
  } else {
    // Default: CSV
    return parsearCSV(buffer.toString("utf-8"));
  }
}

/**
 * Parse CSV bank statement.
 * Supports multiple delimiter styles (;, ,, \t).
 * Tries to auto-detect columns: fecha, concepto, importe (or debe/haber).
 */
function parsearCSV(content) {
  // Remove BOM
  content = content.replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV vacío o sin datos");

  // Detect delimiter
  const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  // Auto-detect column indices
  const fechaIdx = headers.findIndex((h) =>
    /fecha|date|valor|value.date|f\.valor|fecha.valor|fecha.operacion/.test(h)
  );
  const conceptoIdx = headers.findIndex((h) =>
    /concepto|descripcion|description|detalle|referencia|movimiento/.test(h)
  );
  const importeIdx = headers.findIndex((h) =>
    /importe|amount|cantidad|monto|saldo|total/.test(h)
  );
  const debeIdx = headers.findIndex((h) => /debe|debit|cargo/.test(h));
  const haberIdx = headers.findIndex((h) => /haber|credit|abono|ingreso/.test(h));

  if (fechaIdx === -1) throw new Error("No se encontró columna de fecha en el CSV");
  if (conceptoIdx === -1 && importeIdx === -1 && debeIdx === -1) {
    throw new Error("No se encontraron columnas de concepto/importe en el CSV");
  }

  const movimientos = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    if (cols.length < 2) continue;

    const fechaRaw = cols[fechaIdx] || "";
    const fecha = normalizarFecha(fechaRaw);
    if (!fecha) continue;

    const concepto = conceptoIdx >= 0 ? cols[conceptoIdx] || "" : "";

    let importe = 0;
    if (importeIdx >= 0) {
      importe = parseImporte(cols[importeIdx]);
    } else if (debeIdx >= 0 && haberIdx >= 0) {
      const debe = parseImporte(cols[debeIdx]);
      const haber = parseImporte(cols[haberIdx]);
      importe = haber > 0 ? haber : -debe;
    }

    if (importe === 0 && !concepto) continue;

    movimientos.push({ fecha, concepto, importe });
  }

  return movimientos;
}

/**
 * Parse Excel bank statement.
 */
async function parsearExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel vacío");

  const headers = [];
  ws.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || "").toLowerCase().trim();
  });

  const fechaIdx = headers.findIndex((h) => /fecha|date|valor/.test(h || ""));
  const conceptoIdx = headers.findIndex((h) => /concepto|descripcion|description|detalle/.test(h || ""));
  const importeIdx = headers.findIndex((h) => /importe|amount|cantidad/.test(h || ""));
  const debeIdx = headers.findIndex((h) => /debe|debit|cargo/.test(h || ""));
  const haberIdx = headers.findIndex((h) => /haber|credit|abono/.test(h || ""));

  if (fechaIdx === -1) throw new Error("No se encontró columna de fecha en el Excel");

  const movimientos = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      vals[colNumber - 1] = cell.value;
    });

    const fechaRaw = vals[fechaIdx];
    const fecha = fechaRaw instanceof Date
      ? fechaRaw.toISOString().split("T")[0]
      : normalizarFecha(String(fechaRaw || ""));
    if (!fecha) return;

    const concepto = conceptoIdx >= 0 ? String(vals[conceptoIdx] || "") : "";

    let importe = 0;
    if (importeIdx >= 0) {
      importe = typeof vals[importeIdx] === "number" ? vals[importeIdx] : parseImporte(String(vals[importeIdx] || ""));
    } else if (debeIdx >= 0 && haberIdx >= 0) {
      const debe = typeof vals[debeIdx] === "number" ? vals[debeIdx] : parseImporte(String(vals[debeIdx] || ""));
      const haber = typeof vals[haberIdx] === "number" ? vals[haberIdx] : parseImporte(String(vals[haberIdx] || ""));
      importe = haber > 0 ? haber : -debe;
    }

    if (importe === 0 && !concepto) return;

    movimientos.push({ fecha, concepto, importe });
  });

  return movimientos;
}

/**
 * Parse OFX/QFX bank statement (simple parser).
 */
function parsearOFX(content) {
  const movimientos = [];
  const transactions = content.split("<STMTTRN>").slice(1);

  for (const tx of transactions) {
    const getTag = (tag) => {
      const match = tx.match(new RegExp(`<${tag}>([^<\\r\\n]+)`));
      return match ? match[1].trim() : "";
    };

    const trntype = getTag("TRNTYPE");
    const dtposted = getTag("DTPOSTED");
    const trnamt = getTag("TRNAMT");
    const name = getTag("NAME");
    const memo = getTag("MEMO");

    const fecha = dtposted.length >= 8
      ? `${dtposted.slice(0, 4)}-${dtposted.slice(4, 6)}-${dtposted.slice(6, 8)}`
      : null;
    if (!fecha) continue;

    const importe = parseFloat(trnamt) || 0;
    const concepto = [name, memo].filter(Boolean).join(" - ");

    movimientos.push({ fecha, concepto, importe });
  }

  return movimientos;
}

// =============================================
// IA Matching
// =============================================

/**
 * Matchea movimientos bancarios contra facturas, gastos y nóminas usando IA.
 *
 * @param {Array} movimientos - [{fecha, concepto, importe}]
 * @param {string} empresaId
 * @returns {Array} movimientos enriquecidos con match_tipo, match_id, match_desc, confianza
 */
export async function matchearMovimientos(movimientos, empresaId) {
  // 1. Recopilar candidatos
  const facturasPendientes = await sql`
    SELECT f.id, f.numero, f.total, f.fecha, f.pagado,
           (f.total - COALESCE(f.pagado, 0)) AS saldo,
           c.nombre AS cliente_nombre, c.nif_cif
    FROM factura_180 f
    LEFT JOIN clients_180 c ON c.id = f.cliente_id
    WHERE f.empresa_id = ${empresaId}
      AND f.estado = 'VALIDADA'
      AND (f.total > COALESCE(f.pagado, 0) + 0.01)
    ORDER BY f.fecha DESC
    LIMIT 100
  `;

  const gastosPendientes = await sql`
    SELECT g.id, g.descripcion, g.proveedor, g.total, g.fecha_compra,
           g.metodo_pago, g.numero_factura
    FROM purchases_180 g
    WHERE g.empresa_id = ${empresaId}
      AND g.activo = true
    ORDER BY g.fecha_compra DESC
    LIMIT 100
  `;

  const nominasPendientes = await sql`
    SELECT n.id, n.anio, n.mes, n.liquido, n.bruto,
           e.nombre AS empleado_nombre
    FROM nominas_180 n
    LEFT JOIN employees_180 e ON e.id = n.empleado_id
    WHERE n.empresa_id = ${empresaId}
    ORDER BY n.anio DESC, n.mes DESC
    LIMIT 50
  `;

  // 2. Build context for IA
  const candidatos = [];

  for (const f of facturasPendientes) {
    candidatos.push(
      `F|${f.id}|Factura ${f.numero} - ${f.cliente_nombre || ""} - Saldo: ${Number(f.saldo).toFixed(2)}€ - NIF: ${f.nif_cif || "?"}`
    );
  }

  for (const g of gastosPendientes) {
    candidatos.push(
      `G|${g.id}|Gasto: ${g.descripcion || ""} - ${g.proveedor || ""} - ${Number(g.total).toFixed(2)}€ - Fact: ${g.numero_factura || "?"}`
    );
  }

  for (const n of nominasPendientes) {
    candidatos.push(
      `N|${n.id}|Nómina ${n.empleado_nombre || ""} ${String(n.mes).padStart(2, "0")}/${n.anio} - Líquido: ${Number(n.liquido).toFixed(2)}€`
    );
  }

  // 3. Build movements list
  const movList = movimientos.map((m, idx) =>
    `${idx + 1}. ${m.fecha} | ${m.concepto} | ${m.importe > 0 ? "+" : ""}${m.importe.toFixed(2)}€`
  ).join("\n");

  // 4. Call IA to match
  if (!process.env.ANTHROPIC_API_KEY || candidatos.length === 0) {
    return movimientos.map((m) => ({
      ...m,
      match_tipo: null,
      match_id: null,
      match_desc: null,
      confianza: "sin_match",
    }));
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: movimientos.length * 50 + 200,
      system: `Eres un experto contable español. Tu tarea es matchear movimientos bancarios con facturas, gastos o nóminas.

CANDIDATOS (Tipo|ID|Descripción):
${candidatos.join("\n")}

REGLAS DE MATCHING:
1. COBRO (importe positivo +): matchea con Facturas (F) por importe similar al saldo pendiente
2. PAGO (importe negativo -): matchea con Gastos (G) o Nóminas (N) por importe similar
3. Busca coincidencias por: importe exacto o similar (±5%), nombre/NIF en concepto, número de factura
4. Confianza: "alto" (importe exacto + concepto coincide), "medio" (solo importe coincide), "bajo" (posible match)
5. Si no hay match claro, responde "NONE"

FORMATO RESPUESTA (una línea por movimiento, mismo número):
N. TIPO|ID|CONFIANZA
Ejemplo:
1. F|123|alto
2. G|abc-def|medio
3. NONE
4. N|xyz|bajo`,
      messages: [{
        role: "user",
        content: `Matchea estos ${movimientos.length} movimientos bancarios:\n${movList}`,
      }],
    });

    const texto = response.content[0]?.text?.trim() || "";
    const lineas = texto.split("\n").map((l) => l.trim()).filter((l) => l);

    // Parse results
    const result = movimientos.map((m, idx) => {
      const enriched = { ...m, match_tipo: null, match_id: null, match_desc: null, confianza: "sin_match" };

      for (const linea of lineas) {
        const match = linea.match(new RegExp(`^${idx + 1}[\\.\\)\\-\\s]+(.+)$`));
        if (!match) continue;

        const parts = match[1].trim();
        if (parts === "NONE" || parts.startsWith("NONE")) break;

        const [tipo, id, confianza] = parts.split("|").map((p) => p.trim());

        if (tipo === "F") {
          const factura = facturasPendientes.find((f) => String(f.id) === id);
          if (factura) {
            enriched.match_tipo = "factura";
            enriched.match_id = id;
            enriched.match_desc = `Factura ${factura.numero} - ${factura.cliente_nombre || ""}`;
            enriched.confianza = confianza || "medio";
          }
        } else if (tipo === "G") {
          const gasto = gastosPendientes.find((g) => String(g.id) === id);
          if (gasto) {
            enriched.match_tipo = "gasto";
            enriched.match_id = id;
            enriched.match_desc = `${gasto.proveedor || ""} - ${gasto.descripcion || ""}`;
            enriched.confianza = confianza || "medio";
          }
        } else if (tipo === "N") {
          const nomina = nominasPendientes.find((n) => String(n.id) === id);
          if (nomina) {
            enriched.match_tipo = "nomina";
            enriched.match_id = id;
            enriched.match_desc = `Nómina ${nomina.empleado_nombre || ""} ${String(nomina.mes).padStart(2, "0")}/${nomina.anio}`;
            enriched.confianza = confianza || "medio";
          }
        }
        break;
      }

      return enriched;
    });

    return result;
  } catch (err) {
    console.error("Error matchearMovimientos IA:", err.message);
    return movimientos.map((m) => ({
      ...m,
      match_tipo: null,
      match_id: null,
      match_desc: null,
      confianza: "sin_match",
    }));
  }
}

// =============================================
// Helpers
// =============================================

function normalizarFecha(raw) {
  if (!raw) return null;

  // Try ISO format: YYYY-MM-DD
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  // Try DD/MM/YYYY or DD-MM-YYYY
  m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  // Try DD/MM/YY
  m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (m) {
    const year = parseInt(m[3]) > 50 ? `19${m[3]}` : `20${m[3]}`;
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  return null;
}

function parseImporte(raw) {
  if (!raw || raw === "-") return 0;
  // Handle Spanish format: 1.234,56 → 1234.56
  let cleaned = String(raw).replace(/\s/g, "").replace(/€/g, "");

  // If has both . and , → Spanish format
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    // Only comma → might be decimal separator
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = cleaned.replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  }

  return parseFloat(cleaned) || 0;
}
