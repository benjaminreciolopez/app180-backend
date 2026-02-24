import ExcelJS from "exceljs";
import archiver from "archiver";
import { PassThrough } from "stream";
import { sql } from "../db.js";

// ============================================================
// Helpers
// ============================================================

/**
 * Calcula las fechas de inicio y fin para un trimestre dado.
 * @param {number} anio - Año (e.g. 2026)
 * @param {number} trimestre - Trimestre (1-4)
 * @returns {{ desde: string, hasta: string }} Fechas en formato YYYY-MM-DD
 */
export function getTrimestreDates(anio, trimestre) {
  const y = parseInt(anio, 10);
  const q = parseInt(trimestre, 10);

  const startMonth = (q - 1) * 3; // 0, 3, 6, 9 (JS 0-indexed)
  const endMonth = startMonth + 3;

  const startDate = new Date(y, startMonth, 1);
  const endDate = new Date(y, endMonth, 0); // ultimo dia del trimestre

  const pad = (n) => String(n).padStart(2, "0");

  const desde = `${y}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
  const hasta = `${y}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;

  return { desde, hasta };
}

/**
 * Meses correspondientes a un trimestre (para filtrar nominas por mes).
 */
function getMesesTrimestre(trimestre) {
  const q = parseInt(trimestre, 10);
  const mesInicio = (q - 1) * 3 + 1;
  const mesFin = q * 3;
  return { mesInicio, mesFin };
}

// ============================================================
// Estilos comunes Excel
// ============================================================

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const CURRENCY_FORMAT = '#,##0.00 "€"';
const PERCENT_FORMAT = "0.00%";

/**
 * Aplica estilos de cabecera, auto-filtro y auto-ancho a una hoja.
 */
function styleSheet(worksheet) {
  // Estilo de cabecera (primera fila)
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  headerRow.height = 22;

  // Auto-filtro en las cabeceras
  if (worksheet.columns && worksheet.columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length },
    };
  }

  // Auto-ancho de columnas basado en contenido
  worksheet.columns.forEach((column) => {
    let maxLength = (column.header || "").length;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(Math.max(maxLength + 4, 10), 40);
  });
}

// ============================================================
// Consultas de datos
// ============================================================

async function fetchFacturasEmitidas(empresaId, desde, hasta) {
  return sql`
    SELECT
      f.numero,
      f.fecha,
      c.nombre AS cliente_nombre,
      COALESCE(NULLIF(cfd.nif_cif, ''), NULLIF(c.nif_cif, ''), NULLIF(c.nif, ''), '') AS nif_cliente,
      COALESCE(f.subtotal, 0) AS base_imponible,
      COALESCE(f.iva_global, 0) AS iva_porcentaje,
      COALESCE(f.iva_total, 0) AS iva_total,
      COALESCE(f.total, 0) AS total,
      f.estado,
      COALESCE(f.estado_pago, 'pendiente') AS estado_pago
    FROM factura_180 f
    LEFT JOIN clients_180 c ON f.cliente_id = c.id
    LEFT JOIN client_fiscal_data_180 cfd ON cfd.cliente_id = c.id
    WHERE f.empresa_id = ${empresaId}
      AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
      AND f.fecha >= ${desde}::date
      AND f.fecha <= ${hasta}::date
    ORDER BY f.fecha, f.numero
  `;
}

async function fetchGastosCompras(empresaId, desde, hasta) {
  return sql`
    SELECT
      p.fecha_compra AS fecha,
      COALESCE(p.proveedor, '') AS proveedor,
      '' AS nif_proveedor,
      COALESCE(p.descripcion, '') AS concepto,
      COALESCE(p.categoria, 'general') AS categoria,
      COALESCE(p.base_imponible, 0) AS base_imponible,
      COALESCE(p.iva_porcentaje, 0) AS iva_porcentaje,
      COALESCE(p.iva_importe, 0) AS iva_importe,
      COALESCE(p.total, 0) AS total
    FROM purchases_180 p
    WHERE p.empresa_id = ${empresaId}
      AND p.activo = true
      AND p.fecha_compra >= ${desde}::date
      AND p.fecha_compra <= ${hasta}::date
    ORDER BY p.fecha_compra
  `;
}

async function fetchNominas(empresaId, anio, mesInicio, mesFin) {
  return sql`
    SELECT
      COALESCE(e.nombre, 'Sin asignar') AS empleado,
      n.mes,
      COALESCE(n.bruto, 0) AS bruto,
      COALESCE(n.irpf_retencion, 0) AS irpf_retencion,
      COALESCE(n.seguridad_social_empleado, 0) AS ss_empleado,
      COALESCE(n.seguridad_social_empresa, 0) AS ss_empresa,
      COALESCE(n.liquido, 0) AS neto
    FROM nominas_180 n
    LEFT JOIN employees_180 e ON n.empleado_id = e.id
    WHERE n.empresa_id = ${empresaId}
      AND n.anio = ${parseInt(anio, 10)}
      AND n.mes >= ${mesInicio}
      AND n.mes <= ${mesFin}
    ORDER BY n.mes, e.nombre
  `;
}

async function fetchDatosFiscales(empresaId) {
  const [emisor] = await sql`
    SELECT
      em.nif,
      em.nombre,
      em.nombre_comercial,
      em.direccion,
      em.poblacion,
      em.provincia,
      em.cp,
      em.pais,
      em.telefono,
      em.email,
      em.iban,
      em.registro_mercantil
    FROM emisor_180 em
    WHERE em.empresa_id = ${empresaId}
  `;

  const [empresa] = await sql`
    SELECT tipo_contribuyente
    FROM empresa_180
    WHERE id = ${empresaId}
  `;

  return {
    nif: emisor?.nif || "",
    razon_social: emisor?.nombre || "",
    nombre_comercial: emisor?.nombre_comercial || "",
    tipo_contribuyente: empresa?.tipo_contribuyente || "",
    direccion: emisor?.direccion || "",
    poblacion: emisor?.poblacion || "",
    provincia: emisor?.provincia || "",
    cp: emisor?.cp || "",
    pais: emisor?.pais || "España",
    telefono: emisor?.telefono || "",
    email: emisor?.email || "",
    iban: emisor?.iban || "",
    registro_mercantil: emisor?.registro_mercantil || "",
  };
}

// ============================================================
// 1. generateExcelTrimestral
// ============================================================

/**
 * Genera un workbook Excel multi-hoja con datos trimestrales para la asesoría.
 * @param {string} empresaId
 * @param {number} anio
 * @param {number} trimestre
 * @returns {Promise<Buffer>} Excel buffer (.xlsx)
 */
export async function generateExcelTrimestral(empresaId, anio, trimestre) {
  const { desde, hasta } = getTrimestreDates(anio, trimestre);
  const { mesInicio, mesFin } = getMesesTrimestre(trimestre);

  // Obtener datos en paralelo
  const [facturas, gastos, nominas, datosFiscales] = await Promise.all([
    fetchFacturasEmitidas(empresaId, desde, hasta),
    fetchGastosCompras(empresaId, desde, hasta),
    fetchNominas(empresaId, anio, mesInicio, mesFin),
    fetchDatosFiscales(empresaId),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "APP180 - Contendo";
  workbook.created = new Date();

  // --- Sheet 1: Facturas Emitidas ---
  const wsFacturas = workbook.addWorksheet("Facturas Emitidas");
  wsFacturas.columns = [
    { header: "N° Factura", key: "numero", width: 16 },
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "NIF Cliente", key: "nif_cliente", width: 16 },
    { header: "Base Imponible", key: "base_imponible", width: 16 },
    { header: "Tipo IVA (%)", key: "iva_porcentaje", width: 14 },
    { header: "IVA", key: "iva_total", width: 14 },
    { header: "Total", key: "total", width: 14 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Cobrada", key: "cobrada", width: 10 },
  ];

  for (const f of facturas) {
    wsFacturas.addRow({
      numero: f.numero || "Borrador",
      fecha: f.fecha ? new Date(f.fecha) : "",
      cliente: f.cliente_nombre || "",
      nif_cliente: f.nif_cliente || "",
      base_imponible: parseFloat(f.base_imponible),
      iva_porcentaje: parseFloat(f.iva_porcentaje),
      iva_total: parseFloat(f.iva_total),
      total: parseFloat(f.total),
      estado: f.estado,
      cobrada: f.estado_pago === "cobrada" || f.estado_pago === "pagada" ? "Sí" : "No",
    });
  }

  // Formato moneda en columnas de importe
  wsFacturas.getColumn("base_imponible").numFmt = CURRENCY_FORMAT;
  wsFacturas.getColumn("iva_total").numFmt = CURRENCY_FORMAT;
  wsFacturas.getColumn("total").numFmt = CURRENCY_FORMAT;
  wsFacturas.getColumn("fecha").numFmt = "DD/MM/YYYY";

  styleSheet(wsFacturas);

  // --- Sheet 2: Gastos/Compras ---
  const wsGastos = workbook.addWorksheet("Gastos/Compras");
  wsGastos.columns = [
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Proveedor", key: "proveedor", width: 28 },
    { header: "NIF Proveedor", key: "nif_proveedor", width: 16 },
    { header: "Concepto", key: "concepto", width: 32 },
    { header: "Categoría", key: "categoria", width: 16 },
    { header: "Base", key: "base_imponible", width: 14 },
    { header: "IVA (%)", key: "iva_porcentaje", width: 12 },
    { header: "IVA Importe", key: "iva_importe", width: 14 },
    { header: "Total", key: "total", width: 14 },
  ];

  for (const g of gastos) {
    wsGastos.addRow({
      fecha: g.fecha ? new Date(g.fecha) : "",
      proveedor: g.proveedor,
      nif_proveedor: g.nif_proveedor,
      concepto: g.concepto,
      categoria: g.categoria,
      base_imponible: parseFloat(g.base_imponible),
      iva_porcentaje: parseFloat(g.iva_porcentaje),
      iva_importe: parseFloat(g.iva_importe),
      total: parseFloat(g.total),
    });
  }

  wsGastos.getColumn("base_imponible").numFmt = CURRENCY_FORMAT;
  wsGastos.getColumn("iva_importe").numFmt = CURRENCY_FORMAT;
  wsGastos.getColumn("total").numFmt = CURRENCY_FORMAT;
  wsGastos.getColumn("fecha").numFmt = "DD/MM/YYYY";

  styleSheet(wsGastos);

  // --- Sheet 3: Nóminas ---
  const wsNominas = workbook.addWorksheet("Nóminas");
  wsNominas.columns = [
    { header: "Empleado", key: "empleado", width: 28 },
    { header: "Mes", key: "mes", width: 8 },
    { header: "Salario Bruto", key: "bruto", width: 16 },
    { header: "IRPF Retención", key: "irpf_retencion", width: 16 },
    { header: "SS Trabajador", key: "ss_empleado", width: 16 },
    { header: "SS Empresa", key: "ss_empresa", width: 16 },
    { header: "Salario Neto", key: "neto", width: 16 },
  ];

  for (const n of nominas) {
    wsNominas.addRow({
      empleado: n.empleado,
      mes: parseInt(n.mes, 10),
      bruto: parseFloat(n.bruto),
      irpf_retencion: parseFloat(n.irpf_retencion),
      ss_empleado: parseFloat(n.ss_empleado),
      ss_empresa: parseFloat(n.ss_empresa),
      neto: parseFloat(n.neto),
    });
  }

  wsNominas.getColumn("bruto").numFmt = CURRENCY_FORMAT;
  wsNominas.getColumn("irpf_retencion").numFmt = CURRENCY_FORMAT;
  wsNominas.getColumn("ss_empleado").numFmt = CURRENCY_FORMAT;
  wsNominas.getColumn("ss_empresa").numFmt = CURRENCY_FORMAT;
  wsNominas.getColumn("neto").numFmt = CURRENCY_FORMAT;

  styleSheet(wsNominas);

  // --- Sheet 4: Resumen IVA ---
  const wsResumenIva = workbook.addWorksheet("Resumen IVA");
  wsResumenIva.columns = [
    { header: "Concepto", key: "concepto", width: 32 },
    { header: "Importe", key: "importe", width: 18 },
  ];

  const totalIvaRepercutido = facturas.reduce(
    (sum, f) => sum + parseFloat(f.iva_total || 0),
    0
  );
  const totalIvaSoportado = gastos.reduce(
    (sum, g) => sum + parseFloat(g.iva_importe || 0),
    0
  );
  const diferenciaIva = totalIvaRepercutido - totalIvaSoportado;

  wsResumenIva.addRow({
    concepto: "IVA Repercutido (Ventas)",
    importe: Math.round(totalIvaRepercutido * 100) / 100,
  });
  wsResumenIva.addRow({
    concepto: "IVA Soportado (Compras)",
    importe: Math.round(totalIvaSoportado * 100) / 100,
  });

  // Fila separadora vacía
  wsResumenIva.addRow({});

  const filaDiferencia = wsResumenIva.addRow({
    concepto: diferenciaIva >= 0 ? "A INGRESAR" : "A COMPENSAR / DEVOLVER",
    importe: Math.round(diferenciaIva * 100) / 100,
  });

  // Destacar la fila de resultado
  filaDiferencia.eachCell((cell) => {
    cell.font = { bold: true, size: 12 };
  });

  wsResumenIva.getColumn("importe").numFmt = CURRENCY_FORMAT;

  styleSheet(wsResumenIva);

  // --- Sheet 5: Datos Fiscales ---
  const wsDatos = workbook.addWorksheet("Datos Fiscales");
  wsDatos.columns = [
    { header: "Campo", key: "campo", width: 24 },
    { header: "Valor", key: "valor", width: 40 },
  ];

  const camposFiscales = [
    { campo: "NIF / CIF", valor: datosFiscales.nif },
    { campo: "Razón Social", valor: datosFiscales.razon_social },
    { campo: "Nombre Comercial", valor: datosFiscales.nombre_comercial },
    { campo: "Tipo Contribuyente", valor: datosFiscales.tipo_contribuyente },
    { campo: "Dirección", valor: datosFiscales.direccion },
    { campo: "Población", valor: datosFiscales.poblacion },
    { campo: "Provincia", valor: datosFiscales.provincia },
    { campo: "Código Postal", valor: datosFiscales.cp },
    { campo: "País", valor: datosFiscales.pais },
    { campo: "Teléfono", valor: datosFiscales.telefono },
    { campo: "Email", valor: datosFiscales.email },
    { campo: "IBAN", valor: datosFiscales.iban },
    { campo: "Registro Mercantil", valor: datosFiscales.registro_mercantil },
  ];

  for (const row of camposFiscales) {
    wsDatos.addRow(row);
  }

  styleSheet(wsDatos);

  // Generar Buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// 2. generateCsvPack
// ============================================================

/**
 * Genera strings CSV individuales para el trimestre.
 * @param {string} empresaId
 * @param {number} anio
 * @param {number} trimestre
 * @returns {Promise<Array<{ filename: string, content: string }>>}
 */
export async function generateCsvPack(empresaId, anio, trimestre) {
  const { desde, hasta } = getTrimestreDates(anio, trimestre);
  const { mesInicio, mesFin } = getMesesTrimestre(trimestre);

  const [facturas, gastos, nominas] = await Promise.all([
    fetchFacturasEmitidas(empresaId, desde, hasta),
    fetchGastosCompras(empresaId, desde, hasta),
    fetchNominas(empresaId, anio, mesInicio, mesFin),
  ]);

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const toCsv = (headers, rows) => {
    const headerLine = headers.map((h) => escapeCsv(h.label)).join(",");
    const dataLines = rows.map((row) =>
      headers.map((h) => escapeCsv(h.getValue(row))).join(",")
    );
    return [headerLine, ...dataLines].join("\n");
  };

  // CSV Facturas Emitidas
  const csvFacturas = toCsv(
    [
      { label: "N Factura", getValue: (r) => r.numero || "Borrador" },
      { label: "Fecha", getValue: (r) => r.fecha ? new Date(r.fecha).toLocaleDateString("es-ES") : "" },
      { label: "Cliente", getValue: (r) => r.cliente_nombre || "" },
      { label: "NIF Cliente", getValue: (r) => r.nif_cliente || "" },
      { label: "Base Imponible", getValue: (r) => parseFloat(r.base_imponible).toFixed(2) },
      { label: "Tipo IVA (%)", getValue: (r) => parseFloat(r.iva_porcentaje).toFixed(2) },
      { label: "IVA", getValue: (r) => parseFloat(r.iva_total).toFixed(2) },
      { label: "Total", getValue: (r) => parseFloat(r.total).toFixed(2) },
      { label: "Estado", getValue: (r) => r.estado },
      { label: "Cobrada", getValue: (r) => (r.estado_pago === "cobrada" || r.estado_pago === "pagada") ? "Si" : "No" },
    ],
    facturas
  );

  // CSV Facturas Recibidas (Gastos)
  const csvGastos = toCsv(
    [
      { label: "Fecha", getValue: (r) => r.fecha ? new Date(r.fecha).toLocaleDateString("es-ES") : "" },
      { label: "Proveedor", getValue: (r) => r.proveedor },
      { label: "NIF Proveedor", getValue: (r) => r.nif_proveedor },
      { label: "Concepto", getValue: (r) => r.concepto },
      { label: "Categoria", getValue: (r) => r.categoria },
      { label: "Base Imponible", getValue: (r) => parseFloat(r.base_imponible).toFixed(2) },
      { label: "IVA (%)", getValue: (r) => parseFloat(r.iva_porcentaje).toFixed(2) },
      { label: "IVA Importe", getValue: (r) => parseFloat(r.iva_importe).toFixed(2) },
      { label: "Total", getValue: (r) => parseFloat(r.total).toFixed(2) },
    ],
    gastos
  );

  // CSV Nóminas
  const csvNominas = toCsv(
    [
      { label: "Empleado", getValue: (r) => r.empleado },
      { label: "Mes", getValue: (r) => r.mes },
      { label: "Salario Bruto", getValue: (r) => parseFloat(r.bruto).toFixed(2) },
      { label: "IRPF Retencion", getValue: (r) => parseFloat(r.irpf_retencion).toFixed(2) },
      { label: "SS Trabajador", getValue: (r) => parseFloat(r.ss_empleado).toFixed(2) },
      { label: "SS Empresa", getValue: (r) => parseFloat(r.ss_empresa).toFixed(2) },
      { label: "Salario Neto", getValue: (r) => parseFloat(r.neto).toFixed(2) },
    ],
    nominas
  );

  const q = `Q${trimestre}`;

  return [
    { filename: `facturas_emitidas_${anio}_${q}.csv`, content: csvFacturas },
    { filename: `facturas_recibidas_${anio}_${q}.csv`, content: csvGastos },
    { filename: `nominas_${anio}_${q}.csv`, content: csvNominas },
  ];
}

// ============================================================
// 3. generateZipPack
// ============================================================

/**
 * Genera un ZIP con el Excel y los CSVs del trimestre.
 * @param {string} empresaId
 * @param {number} anio
 * @param {number} trimestre
 * @returns {Promise<Buffer>} ZIP buffer
 */
export async function generateZipPack(empresaId, anio, trimestre) {
  // Generar contenido en paralelo
  const [excelBuffer, csvFiles] = await Promise.all([
    generateExcelTrimestral(empresaId, anio, trimestre),
    generateCsvPack(empresaId, anio, trimestre),
  ]);

  const q = `Q${trimestre}`;

  return new Promise((resolve, reject) => {
    const passThrough = new PassThrough();
    const chunks = [];

    passThrough.on("data", (chunk) => chunks.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(chunks)));
    passThrough.on("error", reject);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    archive.pipe(passThrough);

    // Agregar Excel
    archive.append(excelBuffer, {
      name: `asesoria_${anio}_${q}.xlsx`,
    });

    // Agregar CSVs
    for (const csv of csvFiles) {
      // Agregar BOM UTF-8 para compatibilidad con Excel al abrir CSVs
      const bom = Buffer.from("\uFEFF", "utf-8");
      const csvBuffer = Buffer.concat([bom, Buffer.from(csv.content, "utf-8")]);
      archive.append(csvBuffer, { name: csv.filename });
    }

    archive.finalize();
  });
}
