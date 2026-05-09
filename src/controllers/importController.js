// backend/src/controllers/importController.js
//
// Importación masiva CSV de clientes (deudores) y de facturas históricas.
// Patrón: dos endpoints por entidad — preview (no toca BD) y confirm (aplica).
//
// Cada endpoint usa req.targetEmpresaId || req.user.empresa_id, así que cuando
// el asesor lo lanza desde /asesor/clientes/[id]/clientes el alta se aplica
// a la empresa cliente vinculada.

import { sql } from "../db.js";
import {
  parseCsv,
  parseNumero,
  parseFecha,
  parseBool,
  detectarSerie,
} from "../services/csvImportService.js";

// =============================================================================
// CLIENTES (clients_180 + client_fiscal_data_180)
// =============================================================================

const CLIENTE_HEADER_HINTS = {
  nombre: ["nombre", "razon_social", "razon social", "client", "cliente"],
  nif: ["nif", "cif", "nif_cif", "dni"],
  email: ["email", "correo", "e-mail", "mail"],
  telefono: ["telefono", "teléfono", "tel", "movil", "móvil"],
  direccion: ["direccion", "dirección", "direccion_fiscal"],
  poblacion: ["poblacion", "población", "ciudad", "localidad"],
  provincia: ["provincia", "estado"],
  cp: ["cp", "codigo_postal", "código postal", "postal"],
  pais: ["pais", "país", "country"],
  iva_defecto: ["iva", "iva_defecto", "tipo_iva"],
  exento_iva: ["exento_iva", "exento", "operacion_intracomunitaria"],
};

function mapCol(row, alias) {
  for (const a of alias) {
    if (row[a] != null && row[a] !== "") return String(row[a]).trim();
  }
  return "";
}

/**
 * POST /admin/import/clientes/preview
 * Body: multipart con campo "file" (texto CSV).
 * Devuelve: { headers, rows: [{op, cliente, errores}], totales }
 */
export async function previewClientesCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el CSV" });
    const text = req.file.buffer.toString("utf8");
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: "El CSV no tiene filas (¿falta cabecera?)" });
    }
    const empresaId = req.targetEmpresaId || req.user.empresa_id;

    const out = [];
    let nuevos = 0;
    let actualizar = 0;
    let conError = 0;

    for (const row of rows) {
      const errores = [];
      const c = {
        nombre: mapCol(row, CLIENTE_HEADER_HINTS.nombre),
        nif: mapCol(row, CLIENTE_HEADER_HINTS.nif).toUpperCase(),
        email: mapCol(row, CLIENTE_HEADER_HINTS.email),
        telefono: mapCol(row, CLIENTE_HEADER_HINTS.telefono),
        direccion: mapCol(row, CLIENTE_HEADER_HINTS.direccion),
        poblacion: mapCol(row, CLIENTE_HEADER_HINTS.poblacion),
        provincia: mapCol(row, CLIENTE_HEADER_HINTS.provincia),
        cp: mapCol(row, CLIENTE_HEADER_HINTS.cp),
        pais: mapCol(row, CLIENTE_HEADER_HINTS.pais) || "ES",
        iva_defecto: parseNumero(mapCol(row, CLIENTE_HEADER_HINTS.iva_defecto)),
        exento_iva: parseBool(mapCol(row, CLIENTE_HEADER_HINTS.exento_iva)),
      };

      if (!c.nombre) errores.push("Falta nombre");

      // ¿Existe ya por NIF?
      let op = "crear";
      let existing = null;
      if (c.nif) {
        const r = await sql`
          SELECT id, nombre FROM clients_180
          WHERE empresa_id = ${empresaId} AND UPPER(COALESCE(nif, nif_cif)) = ${c.nif}
          LIMIT 1
        `;
        if (r.length > 0) {
          op = "actualizar";
          existing = r[0];
        }
      }

      if (errores.length > 0) { op = "error"; conError++; }
      else if (op === "crear") nuevos++;
      else actualizar++;

      out.push({ op, cliente: c, existing, errores, line: row.__line });
    }

    res.json({
      headers,
      rows: out,
      totales: { total: rows.length, nuevos, actualizar, conError },
    });
  } catch (err) {
    console.error("previewClientesCsv error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/import/clientes/confirmar
 * Aplica la importación. Body multipart con "file".
 */
export async function confirmClientesCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el CSV" });
    const text = req.file.buffer.toString("utf8");
    const { rows } = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: "El CSV no tiene filas" });
    }
    const empresaId = req.targetEmpresaId || req.user.empresa_id;

    let creados = 0, actualizados = 0, errores = [];

    // Calcular siguiente código base UNA vez al inicio para evitar locks innecesarios
    const [maxCodigo] = await sql`
      SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(codigo, '[^0-9]', '', 'g'), '') AS INTEGER)), 0) AS max_n
      FROM clients_180 WHERE empresa_id = ${empresaId}
    `;
    let nextCodigoNum = (parseInt(maxCodigo?.max_n || 0, 10)) + 1;

    for (const row of rows) {
      try {
        const c = {
          nombre: mapCol(row, CLIENTE_HEADER_HINTS.nombre),
          nif: mapCol(row, CLIENTE_HEADER_HINTS.nif).toUpperCase(),
          email: mapCol(row, CLIENTE_HEADER_HINTS.email),
          telefono: mapCol(row, CLIENTE_HEADER_HINTS.telefono),
          direccion: mapCol(row, CLIENTE_HEADER_HINTS.direccion),
          poblacion: mapCol(row, CLIENTE_HEADER_HINTS.poblacion),
          provincia: mapCol(row, CLIENTE_HEADER_HINTS.provincia),
          cp: mapCol(row, CLIENTE_HEADER_HINTS.cp),
          pais: (mapCol(row, CLIENTE_HEADER_HINTS.pais) || "ES").substring(0, 2).toUpperCase(),
          iva_defecto: parseNumero(mapCol(row, CLIENTE_HEADER_HINTS.iva_defecto)),
          exento_iva: parseBool(mapCol(row, CLIENTE_HEADER_HINTS.exento_iva)),
        };

        if (!c.nombre) {
          errores.push({ line: row.__line, error: "Falta nombre" });
          continue;
        }

        // Buscar por NIF
        let existing = null;
        if (c.nif) {
          const r = await sql`
            SELECT id FROM clients_180
            WHERE empresa_id = ${empresaId} AND UPPER(COALESCE(nif, nif_cif)) = ${c.nif}
            LIMIT 1
          `;
          if (r.length > 0) existing = r[0];
        }

        if (existing) {
          await sql`
            UPDATE clients_180 SET
              nombre = ${c.nombre},
              email = COALESCE(NULLIF(${c.email}, ''), email),
              telefono = COALESCE(NULLIF(${c.telefono}, ''), telefono),
              direccion = COALESCE(NULLIF(${c.direccion}, ''), direccion),
              poblacion = COALESCE(NULLIF(${c.poblacion}, ''), poblacion),
              provincia = COALESCE(NULLIF(${c.provincia}, ''), provincia),
              cp = COALESCE(NULLIF(${c.cp}, ''), cp),
              codigo_postal = COALESCE(NULLIF(${c.cp}, ''), codigo_postal)
            WHERE id = ${existing.id}
          `;
          actualizados++;
        } else {
          // Generar código incremental
          const codigo = String(nextCodigoNum).padStart(4, "0");
          nextCodigoNum++;
          await sql`
            INSERT INTO clients_180 (
              empresa_id, nombre, codigo, tipo,
              direccion, telefono, nif, nif_cif,
              poblacion, municipio, provincia, cp, codigo_postal, pais, email,
              modo_defecto, requiere_geo, activo,
              razon_social, iva_defecto, exento_iva
            ) VALUES (
              ${empresaId}, ${c.nombre}, ${codigo}, 'cliente',
              ${c.direccion || null}, ${c.telefono || null}, ${c.nif || null}, ${c.nif || null},
              ${c.poblacion || null}, ${c.poblacion || null}, ${c.provincia || null},
              ${c.cp || null}, ${c.cp || null}, ${c.pais}, ${c.email || null},
              'mixto', false, true,
              ${c.nombre}, ${c.iva_defecto != null ? c.iva_defecto : 21},
              ${c.exento_iva || false}
            )
          `;
          creados++;
        }
      } catch (e) {
        errores.push({ line: row.__line, error: e.message });
      }
    }

    res.json({ creados, actualizados, errores, total: rows.length });
  } catch (err) {
    console.error("confirmClientesCsv error:", err);
    res.status(500).json({ error: err.message });
  }
}

// =============================================================================
// FACTURAS
// =============================================================================

const FACTURA_HEADER_HINTS = {
  fecha: ["fecha", "fecha_factura", "fecha emision"],
  numero: ["numero", "número", "n_factura", "factura", "num"],
  serie: ["serie"],
  cliente_nif: ["cliente_nif", "nif_cliente", "nif", "cif"],
  cliente_nombre: ["cliente", "cliente_nombre", "nombre_cliente", "razon_social"],
  concepto: ["concepto", "descripcion", "descripción"],
  base: ["base", "base_imponible", "subtotal", "neto"],
  iva_pct: ["iva", "iva_pct", "tipo_iva", "porcentaje_iva"],
  iva_importe: ["iva_importe", "cuota_iva", "importe_iva"],
  retencion_pct: ["retencion", "retención", "irpf"],
  total: ["total", "importe_total", "importe"],
  metodo_pago: ["metodo_pago", "método_pago", "forma_pago"],
  estado: ["estado"],
};

/**
 * POST /admin/import/facturas/preview
 */
export async function previewFacturasCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el CSV" });
    const text = req.file.buffer.toString("utf8");
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: "El CSV no tiene filas" });
    }
    const empresaId = req.targetEmpresaId || req.user.empresa_id;

    const out = [];
    let nuevas = 0, duplicadas = 0, conError = 0;
    const seriesDetectadas = new Set();
    const nifsClientesNuevos = new Set();

    for (const row of rows) {
      const errores = [];
      const f = {
        fecha: parseFecha(mapCol(row, FACTURA_HEADER_HINTS.fecha)),
        numero: mapCol(row, FACTURA_HEADER_HINTS.numero),
        serie: mapCol(row, FACTURA_HEADER_HINTS.serie),
        cliente_nif: mapCol(row, FACTURA_HEADER_HINTS.cliente_nif).toUpperCase(),
        cliente_nombre: mapCol(row, FACTURA_HEADER_HINTS.cliente_nombre),
        concepto: mapCol(row, FACTURA_HEADER_HINTS.concepto) || "Factura importada",
        base: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.base)),
        iva_pct: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.iva_pct)),
        iva_importe: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.iva_importe)),
        retencion_pct: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.retencion_pct)),
        total: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.total)),
        metodo_pago: mapCol(row, FACTURA_HEADER_HINTS.metodo_pago) || "TRANSFERENCIA",
      };

      if (!f.fecha) errores.push("Fecha inválida");
      if (!f.numero) errores.push("Falta número");
      if (f.base == null && f.total == null) errores.push("Falta base/total");
      if (!f.cliente_nif && !f.cliente_nombre) errores.push("Falta cliente (NIF o nombre)");

      // Serie: si no viene, detectar
      if (!f.serie && f.numero) f.serie = detectarSerie(f.numero);
      if (f.serie) seriesDetectadas.add(f.serie);

      // Resolver cliente: primero por NIF, luego por nombre
      let cliente = null;
      if (f.cliente_nif) {
        const r = await sql`
          SELECT id, nombre FROM clients_180
          WHERE empresa_id = ${empresaId} AND UPPER(COALESCE(nif, nif_cif)) = ${f.cliente_nif}
          LIMIT 1
        `;
        if (r.length > 0) cliente = r[0];
      }
      if (!cliente && f.cliente_nombre) {
        const r = await sql`
          SELECT id, nombre FROM clients_180
          WHERE empresa_id = ${empresaId} AND nombre ILIKE ${f.cliente_nombre}
          LIMIT 1
        `;
        if (r.length > 0) cliente = r[0];
      }
      let cliente_creara = false;
      if (!cliente) {
        cliente_creara = true;
        if (f.cliente_nif) nifsClientesNuevos.add(f.cliente_nif);
      }

      // Detectar duplicado por (numero) en la empresa
      let duplicada = false;
      if (f.numero) {
        const dup = await sql`
          SELECT id FROM factura_180
          WHERE empresa_id = ${empresaId} AND numero = ${f.numero}
          LIMIT 1
        `;
        if (dup.length > 0) duplicada = true;
      }

      // Cruce con asiento existente: misma fecha + total ± 0.02 + cuenta cliente típica (4300 + nif)
      let asiento_match = null;
      if (f.fecha && f.total != null) {
        const totalNum = Number(f.total);
        try {
          const ax = await sql`
            SELECT a.id, a.numero
            FROM asientos_180 a
            JOIN asiento_lineas_180 l ON l.asiento_id = a.id
            WHERE a.empresa_id = ${empresaId}
              AND a.fecha = ${f.fecha}
              AND ABS((l.debe + l.haber) - ${totalNum}) <= 0.02
              AND a.estado != 'anulado'
            LIMIT 1
          `;
          if (ax.length > 0) asiento_match = ax[0];
        } catch { /* tabla puede no existir aún en algunos entornos */ }
      }

      let op = "crear";
      if (errores.length > 0) { op = "error"; conError++; }
      else if (duplicada) { op = "duplicada"; duplicadas++; }
      else nuevas++;

      out.push({
        op,
        factura: f,
        cliente_existente: cliente,
        cliente_creara,
        duplicada,
        asiento_match,
        errores,
        line: row.__line,
      });
    }

    res.json({
      headers,
      rows: out,
      totales: {
        total: rows.length,
        nuevas,
        duplicadas,
        conError,
        clientes_nuevos: nifsClientesNuevos.size,
        series_detectadas: Array.from(seriesDetectadas),
      },
    });
  } catch (err) {
    console.error("previewFacturasCsv error:", err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/import/facturas/confirmar
 */
export async function confirmFacturasCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el CSV" });
    const text = req.file.buffer.toString("utf8");
    const { rows } = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: "El CSV no tiene filas" });
    }
    const empresaId = req.targetEmpresaId || req.user.empresa_id;
    const skipDuplicadas = req.body?.skip_duplicadas !== "false";

    let creadas = 0, omitidas = 0, errores = [];
    let clientesCreados = 0;
    let asientosVinculados = 0;

    // Para clientes auto-creados, calcular código base
    const [maxCodigo] = await sql`
      SELECT COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(codigo, '[^0-9]', '', 'g'), '') AS INTEGER)), 0) AS max_n
      FROM clients_180 WHERE empresa_id = ${empresaId}
    `;
    let nextCodigoNum = (parseInt(maxCodigo?.max_n || 0, 10)) + 1;

    for (const row of rows) {
      try {
        const f = {
          fecha: parseFecha(mapCol(row, FACTURA_HEADER_HINTS.fecha)),
          numero: mapCol(row, FACTURA_HEADER_HINTS.numero),
          serie: mapCol(row, FACTURA_HEADER_HINTS.serie),
          cliente_nif: mapCol(row, FACTURA_HEADER_HINTS.cliente_nif).toUpperCase(),
          cliente_nombre: mapCol(row, FACTURA_HEADER_HINTS.cliente_nombre),
          concepto: mapCol(row, FACTURA_HEADER_HINTS.concepto) || "Factura importada",
          base: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.base)),
          iva_pct: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.iva_pct)),
          iva_importe: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.iva_importe)),
          retencion_pct: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.retencion_pct)),
          total: parseNumero(mapCol(row, FACTURA_HEADER_HINTS.total)),
          metodo_pago: (mapCol(row, FACTURA_HEADER_HINTS.metodo_pago) || "TRANSFERENCIA").toUpperCase(),
        };

        if (!f.fecha || !f.numero || (f.base == null && f.total == null)) {
          errores.push({ line: row.__line, error: "Datos mínimos faltantes (fecha, numero, base/total)" });
          continue;
        }
        if (!f.cliente_nif && !f.cliente_nombre) {
          errores.push({ line: row.__line, error: "Falta cliente" });
          continue;
        }
        if (!f.serie) f.serie = detectarSerie(f.numero);

        // Calcular totales si faltan
        if (f.base == null && f.total != null) {
          const ivaPct = f.iva_pct != null ? f.iva_pct : 0;
          f.base = Number((f.total / (1 + ivaPct / 100)).toFixed(2));
          f.iva_importe = Number((f.total - f.base).toFixed(2));
        } else if (f.total == null && f.base != null) {
          const ivaPct = f.iva_pct != null ? f.iva_pct : 0;
          f.iva_importe = Number((f.base * ivaPct / 100).toFixed(2));
          f.total = Number((f.base + f.iva_importe).toFixed(2));
        }

        // Resolver / crear cliente
        let clienteId = null;
        if (f.cliente_nif) {
          const r = await sql`
            SELECT id FROM clients_180
            WHERE empresa_id = ${empresaId} AND UPPER(COALESCE(nif, nif_cif)) = ${f.cliente_nif}
            LIMIT 1
          `;
          if (r.length > 0) clienteId = r[0].id;
        }
        if (!clienteId && f.cliente_nombre) {
          const r = await sql`
            SELECT id FROM clients_180
            WHERE empresa_id = ${empresaId} AND nombre ILIKE ${f.cliente_nombre}
            LIMIT 1
          `;
          if (r.length > 0) clienteId = r[0].id;
        }
        if (!clienteId) {
          // Auto-crear
          const codigo = String(nextCodigoNum).padStart(4, "0");
          nextCodigoNum++;
          const [nuevo] = await sql`
            INSERT INTO clients_180 (
              empresa_id, nombre, codigo, tipo, nif, nif_cif, pais,
              modo_defecto, requiere_geo, activo, razon_social, iva_defecto
            ) VALUES (
              ${empresaId},
              ${f.cliente_nombre || f.cliente_nif || "Cliente importado"},
              ${codigo}, 'cliente',
              ${f.cliente_nif || null}, ${f.cliente_nif || null}, 'ES',
              'mixto', false, true,
              ${f.cliente_nombre || f.cliente_nif || "Cliente importado"},
              ${f.iva_pct != null ? f.iva_pct : 21}
            )
            RETURNING id
          `;
          clienteId = nuevo.id;
          clientesCreados++;
        }

        // Duplicado por número en la empresa
        const dup = await sql`
          SELECT id FROM factura_180
          WHERE empresa_id = ${empresaId} AND numero = ${f.numero}
          LIMIT 1
        `;
        if (dup.length > 0) {
          if (skipDuplicadas) {
            omitidas++;
            continue;
          }
          errores.push({ line: row.__line, error: `Factura ${f.numero} ya existe` });
          continue;
        }

        // Cruce con asiento existente (mismo día + importe ± 0.02)
        let asientoId = null;
        try {
          const ax = await sql`
            SELECT DISTINCT a.id
            FROM asientos_180 a
            JOIN asiento_lineas_180 l ON l.asiento_id = a.id
            WHERE a.empresa_id = ${empresaId}
              AND a.fecha = ${f.fecha}
              AND ABS((l.debe + l.haber) - ${f.total}) <= 0.02
              AND a.estado != 'anulado'
            LIMIT 1
          `;
          if (ax.length > 0) {
            asientoId = ax[0].id;
            asientosVinculados++;
          }
        } catch { /* asientos puede no existir */ }

        // Insertar factura
        await sql`
          INSERT INTO factura_180 (
            empresa_id, cliente_id, numero, serie, fecha,
            subtotal, iva_global, iva_total, total,
            estado, importada, asiento_id, mensaje_iva
          ) VALUES (
            ${empresaId}, ${clienteId}, ${f.numero}, ${f.serie || null}, ${f.fecha},
            ${f.base}, ${f.iva_pct != null ? f.iva_pct : 0}, ${f.iva_importe || 0}, ${f.total},
            'VALIDADA', true, ${asientoId},
            ${f.concepto}
          )
        `;
        creadas++;
      } catch (e) {
        errores.push({ line: row.__line, error: e.message });
      }
    }

    res.json({
      total: rows.length,
      creadas,
      omitidas_duplicadas: omitidas,
      clientes_creados: clientesCreados,
      asientos_vinculados: asientosVinculados,
      errores,
    });
  } catch (err) {
    console.error("confirmFacturasCsv error:", err);
    res.status(500).json({ error: err.message });
  }
}

// =============================================================================
// IMPORTAR PDF de factura individual (heurístico)
// =============================================================================

/**
 * Heurístico: extrae fecha, número, NIF cliente, base, IVA % e importe total
 * del texto plano de un PDF de factura. Devuelve campos null si no encuentra.
 */
function parsearTextoFactura(texto) {
  const t = (texto || "").replace(/\s+/g, " ");

  // Número de factura: patrón típico "Factura nº 2026/A/0027" o "Nº 2026-A-0027"
  let numero = null;
  const reNum = /(?:factura|fra\.?|n[ºo°])\s*[:\s]*([A-Z]?\d{1,4}[\/\-_][A-Z\d]{1,4}[\/\-_]?\d{0,6}|[A-Z]?\d{4,10})/i;
  const m1 = t.match(reNum);
  if (m1) numero = m1[1];

  // Fecha
  let fecha = null;
  const reFecha = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/;
  const m2 = t.match(reFecha);
  if (m2) {
    const yyyy = m2[3].length === 2 ? `20${m2[3]}` : m2[3];
    fecha = `${yyyy}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  }

  // NIF/CIF
  let nif = null;
  const reNif = /\b([A-HJNP-SUVW]\d{8}|[0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])\b/;
  const m3 = (texto || "").match(reNif);
  if (m3) nif = m3[1];

  // Total (€)
  let total = null;
  const reTotal = /total[^\d€]{0,40}?([\d.]{1,9},\d{2})\s*(?:€|EUR)?/i;
  const m4 = t.match(reTotal);
  if (m4) total = parseFloat(m4[1].replace(/\./g, "").replace(",", "."));

  // Base imponible
  let base = null;
  const reBase = /base\s*(?:imponible)?[^\d€]{0,30}?([\d.]{1,9},\d{2})/i;
  const m5 = t.match(reBase);
  if (m5) base = parseFloat(m5[1].replace(/\./g, "").replace(",", "."));

  // IVA %
  let iva_pct = null;
  const reIva = /\b(21|10|4|0)\s*%?\s*(?:de\s+)?iva/i;
  const m6 = t.match(reIva);
  if (m6) iva_pct = parseInt(m6[1], 10);

  return { numero, fecha, cliente_nif: nif, base, iva_pct, total };
}

/**
 * POST /admin/import/facturas/parsear-pdf
 * Recibe un PDF, devuelve datos extraídos (sin tocar BD). El UI los usa
 * para autorrellenar el formulario de crear factura.
 */
export async function parsearPdfFactura(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el PDF" });
    const { extractFullPdfText } = await import("../services/ocr/ocrEngine.js");
    const texto = await extractFullPdfText(req.file.buffer, 5);
    const datos = parsearTextoFactura(texto);
    res.json({ datos, longitud_texto: texto.length });
  } catch (err) {
    console.error("parsearPdfFactura error:", err);
    res.status(500).json({ error: err.message || "Error parseando PDF" });
  }
}

// =============================================================================
// PLANTILLAS CSV (descarga) — devuelve un CSV con cabeceras y un ejemplo.
// =============================================================================

export function plantillaClientesCsv(req, res) {
  const csv =
    "nombre;nif;email;telefono;direccion;poblacion;provincia;cp;pais;iva_defecto;exento_iva\n" +
    "Cliente Ejemplo S.L.;B12345678;cliente@ejemplo.com;612345678;Calle Mayor 1;Madrid;Madrid;28001;ES;21;no\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="plantilla_clientes.csv"');
  res.send(csv);
}

export function plantillaFacturasCsv(req, res) {
  const csv =
    "fecha;numero;serie;cliente_nif;cliente_nombre;concepto;base;iva_pct;iva_importe;retencion_pct;total;metodo_pago\n" +
    "01/03/2026;2026/A/0001;2026/A;B12345678;Cliente Ejemplo S.L.;Servicios profesionales marzo;1000,00;21;210,00;0;1210,00;TRANSFERENCIA\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="plantilla_facturas.csv"');
  res.send(csv);
}
