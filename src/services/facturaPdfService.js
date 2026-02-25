import { sql } from '../db.js';
import { generatePdf } from './exportService.js';
import QRCode from 'qrcode';
import { construirUrlQr } from './verifactuService.js';
import path from 'path';
import fs from 'fs';

/**
 * Estilos para PDF de factura - MULTI-PAGINA con numeracion encadenada
 * Layout de flujo (no absoluto) para paginacion automatica de Puppeteer
 */
const FACTURA_STYLES = `
<style>
  @page {
    size: A4;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica', Arial, sans-serif;
    color: #000;
    width: 210mm;
    min-height: 297mm;
    -webkit-print-color-adjust: exact;
  }

  /* ===== PRIMERA PAGINA: HEADER COMPLETO ===== */
  .first-page-header {
    padding: 20pt 30pt 15pt 30pt;
    position: relative;
    min-height: 190pt;
    page-break-inside: avoid;
  }

  .header-title {
    text-align: center;
    font-weight: bold;
    font-size: 22pt;
    text-transform: uppercase;
    padding-top: 5pt;
    margin-bottom: 10pt;
  }

  .header-columns {
    display: flex;
    justify-content: space-between;
    gap: 20pt;
  }

  .header-left {
    flex: 1;
    max-width: 48%;
  }

  .header-right {
    flex: 1;
    max-width: 48%;
    text-align: left;
  }

  .logo-img {
    max-width: 100pt;
    max-height: 70pt;
    display: block;
    margin-bottom: 10pt;
  }

  .emisor-nombre {
    font-size: 12pt;
    font-weight: bold;
    margin-bottom: 4pt;
  }

  .emisor-details {
    font-size: 10pt;
    line-height: 1.3;
  }

  .meta-block {
    font-weight: bold;
    font-size: 11pt;
    margin-bottom: 12pt;
  }
  .meta-block div { margin-bottom: 4pt; }

  .cliente-label {
    font-weight: bold;
    font-size: 11pt;
    margin-bottom: 4pt;
  }

  .cliente-data {
    font-size: 10pt;
    line-height: 1.3;
  }

  /* QR - entre emisor y cliente */
  .qr-block {
    position: absolute;
    top: 85pt;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    z-index: 5;
  }
  .qr-img {
    width: 22mm;
    height: 22mm;
    display: block;
    margin: 0 auto;
  }
  .verifactu-label {
    font-size: 8pt;
    margin-top: 5pt;
    color: #000;
    line-height: 1.1;
    font-weight: bold;
    text-transform: uppercase;
  }

  /* MARCA DE AGUA TEST */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(45deg);
    font-size: 40pt;
    font-weight: bold;
    color: rgba(230, 230, 230, 0.5);
    z-index: -1;
    pointer-events: none;
    white-space: nowrap;
    text-transform: uppercase;
  }

  /* ===== TABLA DE LINEAS ===== */
  .table-section {
    padding: 0 30pt;
  }

  table.lineas-table {
    width: 100%;
    border-collapse: collapse;
  }

  thead {
    display: table-header-group;
  }

  thead th {
    font-weight: bold;
    font-size: 10pt;
    text-align: left;
    padding: 8pt 0;
    border-bottom: 1pt solid #000;
  }

  tbody td {
    padding: 8pt 0;
    font-size: 9pt;
    vertical-align: top;
    border-bottom: 0.5pt solid #eee;
  }

  tr {
    page-break-inside: avoid;
  }

  .col-cant { width: 45pt; text-align: center; }
  .col-desc { width: auto; text-align: left; padding-left: 15pt; }
  .col-price { width: 80pt; text-align: right; }
  .col-iva { width: 50pt; text-align: center; }
  .col-total { width: 80pt; text-align: right; }

  /* ===== TOTALES ===== */
  .totals-section {
    page-break-inside: avoid;
    padding: 15pt 30pt 0 30pt;
    display: flex;
    justify-content: flex-end;
  }

  .totals-block {
    width: 250pt;
    text-align: right;
    font-size: 11pt;
    font-weight: bold;
  }
  .total-row {
    margin-bottom: 6pt;
  }
  .total-final {
    font-size: 12pt;
    padding-top: 5pt;
    border-top: 1pt solid #000;
  }

  /* ===== MENSAJE IVA ===== */
  .mensaje-iva-section {
    page-break-inside: avoid;
    padding: 10pt 30pt 0 30pt;
    font-style: italic;
    font-size: 10pt;
    line-height: 1.2;
  }

  /* ===== LEGAL / PIE ===== */
  .legal-section {
    page-break-inside: avoid;
    padding: 15pt 30pt 30pt 30pt;
    font-size: 9pt;
    color: #444;
    border-top: 0.5pt solid #eee;
    margin-top: 15pt;
  }
  .thanks-msg {
    margin-bottom: 5pt;
    font-weight: bold;
    color: #000;
  }
  .verifactu-notice-inline {
    font-size: 8.5pt;
    color: #555;
    font-style: italic;
    margin-top: 8pt;
  }

  /* ===== SPACER: empuja totales al fondo en facturas cortas (1 pag) ===== */
  .content-wrapper {
    display: flex;
    flex-direction: column;
    min-height: calc(297mm - 12mm - 15mm); /* A4 menos margenes header/footer de Puppeteer */
  }
  .flex-grow-spacer {
    flex: 1;
  }
</style>
`;

/**
 * Genera el HTML de una factura con soporte multi-pagina
 */
export const generarHtmlFactura = async (factura, emisor, cliente, lineas, config, options = {}) => {
  const esRectificativa = String(factura.numero).endsWith('R');
  const titulo = esRectificativa ? 'FACTURA RECTIFICATIVA' : 'FACTURA';

  const isTest = config && config.verifactu_activo && config.verifactu_modo === 'TEST';

  // 1. Logo
  let logoHtml = '';
  if (emisor.logo_path) {
    try {
      let src = '';
      const logo = emisor.logo_path;

      if (logo.startsWith('data:') || logo.startsWith('http')) {
        src = logo;
      } else if (logo.length > 100 && !logo.includes('/') && !logo.includes('\\')) {
        src = `data:image/png;base64,${logo}`;
      } else {
        const cleanPath = logo.replace(/^\//, '').replace(/^api\/uploads\//, '');
        const fsPath = path.join(process.cwd(), 'uploads', cleanPath);
        if (fs.existsSync(fsPath)) {
          const imgData = fs.readFileSync(fsPath).toString('base64');
          const ext = path.extname(fsPath).substring(1) || 'png';
          src = `data:image/${ext};base64,${imgData}`;
        } else {
          src = `http://localhost:5000/api/uploads/${cleanPath}`;
        }
      }
      logoHtml = `<img src="${src}" class="logo-img" />`;
    } catch (e) {
      console.error("[PDF] Error procesando logo:", e);
    }
  }

  // 2. QR Code y Aviso VeriFactu
  let qrHtml = '';
  let verifactuNoticeHtml = '';
  const verifactuText = "Factura expedida por un sistema informático de facturación conforme al Reglamento de facturación aprobado por el Real Decreto 1619/2012 (Veri*Factu).";

  if (config && config.verifactu_activo) {
    verifactuNoticeHtml = `<div class="verifactu-notice-inline">${verifactuText}</div>`;

    if (factura.verifactu_hash) {
      try {
        const urlQr = construirUrlQr(factura, emisor, config, (config.verifactu_modo === 'TEST' ? 'PRUEBAS' : 'PRODUCCION'));
        const qrDataUrl = await QRCode.toDataURL(urlQr, { margin: 0, errorCorrectionLevel: 'M' });
        qrHtml = `
          <div class="qr-block">
            <img src="${qrDataUrl}" class="qr-img" />
            <div class="verifactu-label">VERI*FACTU</div>
          </div>
        `;
      } catch (err) {
        console.error("Error generando QR:", err);
      }
    }
  }

  // 3. Totales y desglose IVA
  const subtotal = Number(factura.subtotal || 0);
  const total = Number(factura.total || 0);
  const ivaGlobal = Number(factura.iva_global || 0);

  const desgloseIva = lineas.reduce((acc, l) => {
    const pct = Number(l.iva_percent || ivaGlobal);
    const base = Number(l.cantidad) * Number(l.precio_unitario);
    const cuota = base * (pct / 100);
    if (!acc[pct]) acc[pct] = { base: 0, cuota: 0 };
    acc[pct].base += base;
    acc[pct].cuota += cuota;
    return acc;
  }, {});

  // 4. Direcciones
  const fmtDir = (obj) => {
    const p1 = obj.direccion || obj.direccion_fiscal || '';
    const p2 = `${obj.codigo_postal || obj.cp || ''} ${obj.municipio || obj.poblacion || ''}`.trim();
    const p3 = `${obj.provincia || obj.prov_fiscal || ''} ${obj.pais || ''}`.trim();
    return [p1, p2, p3].filter(Boolean).join('<br>');
  };

  const emisorAddress = fmtDir(emisor);
  const clienteNombre = cliente.razon_social || cliente.nombre || '';
  const clienteAddress = fmtDir(cliente);

  // 5. Lineas HTML
  const lineasHtml = lineas.map(l => `
    <tr>
      <td class="col-cant">${Number(l.cantidad).toFixed(2)}</td>
      <td class="col-desc">${l.descripcion || ''}</td>
      <td class="col-price">${Number(l.precio_unitario).toFixed(2)} &euro;</td>
      <td class="col-iva">${Number(l.iva_percent || ivaGlobal).toFixed(2)}%</td>
      <td class="col-total">${Number(l.total).toFixed(2)} &euro;</td>
    </tr>
  `).join('');

  // 6. Pie de pagina y pago
  const ibanEmisor = emisor.cuenta_bancaria || emisor.iban || '';
  const metodoPago = factura.metodo_pago || 'TRANSFERENCIA';

  let pagoHtml = '';
  if (metodoPago === 'CONTADO') {
    pagoHtml = 'Forma de pago: Al contado / Efectivo';
  } else if (ibanEmisor) {
    pagoHtml = `Forma de pago: Transferencia bancaria<br>IBAN: ${ibanEmisor}`;
  } else {
    pagoHtml = 'Forma de pago: Transferencia bancaria';
  }

  let cleanTextoPie = emisor.texto_pie || '';
  if (cleanTextoPie.includes("Veri*Factu")) {
    cleanTextoPie = cleanTextoPie.replace(/Factura emitida bajo el sistema Veri\*Factu de la AEAT\.\s*/g, '');
    cleanTextoPie = cleanTextoPie.replace(/Gracias por su confianza\./g, '');
  }

  // Determinar si la factura es corta (cabe en 1 pagina) para anclar totales al fondo
  // Header ~190pt + tabla ~(lineas * 25pt) + totales ~80pt + legal ~80pt
  // Espacio usable A4 con margenes Puppeteer (12mm top + 15mm bottom) ≈ 740pt
  const estimatedTableHeight = lineas.length * 25;
  const estimatedTotalHeight = 190 + estimatedTableHeight + 80 + 80;
  const isShortInvoice = estimatedTotalHeight < 700;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${FACTURA_STYLES}
</head>
<body>
  <div class="content-wrapper">
    ${isTest ? '<div class="watermark">ENTORNO DE PRUEBAS</div>' : ''}

    <!-- HEADER COMPLETO (pagina 1) -->
    <div class="first-page-header">
      <div class="header-title">${titulo}</div>

      ${qrHtml}

      <div class="header-columns">
        <div class="header-left">
          ${logoHtml}
          <div class="emisor-nombre">${emisor.nombre || ''}</div>
          <div class="emisor-details">
            ${emisorAddress}${emisorAddress ? '<br>' : ''}
            ${emisor.nif ? `CIF: ${emisor.nif}<br>` : ''}
            ${emisor.telefono ? `Tel: ${emisor.telefono}<br>` : ''}
            ${emisor.email ? `Email: ${emisor.email}` : ''}
          </div>
        </div>

        <div class="header-right">
          <div class="meta-block">
            <div>Fecha: ${new Date(factura.fecha).toLocaleDateString('es-ES')}</div>
            <div>N&ordm; FACTURA: ${factura.numero}</div>
          </div>
          <div class="cliente-label">Datos del cliente:</div>
          <div class="cliente-data">
            <strong>${clienteNombre}</strong><br>
            ${cliente.nif_cif || cliente.nif ? `NIF: ${cliente.nif_cif || cliente.nif}<br>` : ''}
            ${clienteAddress}
          </div>
        </div>
      </div>
    </div>

    <!-- TABLA DE LINEAS (paginacion automatica por Puppeteer) -->
    <div class="table-section">
      <table class="lineas-table">
        <thead>
          <tr>
            <th class="col-cant">CANT.</th>
            <th class="col-desc">DESCRIPCI&Oacute;N</th>
            <th class="col-price">P. UNIT.</th>
            <th class="col-iva">IVA</th>
            <th class="col-total">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${lineasHtml}
        </tbody>
      </table>
    </div>

    <!-- SPACER: en facturas cortas empuja totales al fondo de la pagina -->
    ${isShortInvoice ? '<div class="flex-grow-spacer"></div>' : ''}

    <!-- TOTALES -->
    <div class="totals-section">
      <div class="totals-block">
        <div class="total-row">Subtotal: ${subtotal.toFixed(2)} &euro;</div>
        ${Object.entries(desgloseIva).map(([pct, data]) => `
          <div class="total-row">IVA (${pct}%): ${data.cuota.toFixed(2)} &euro;</div>
        `).join('')}
        <div class="total-row total-final">TOTAL FACTURA: ${total.toFixed(2)} &euro;</div>
      </div>
    </div>

    ${factura.mensaje_iva ? `
    <div class="mensaje-iva-section">
      ${factura.mensaje_iva}
    </div>` : ''}

    <!-- PIE / LEGAL -->
    <div class="legal-section">
      <div class="thanks-msg">¡Gracias por su confianza!</div>
      ${pagoHtml}<br>
      ${cleanTextoPie.trim()}
      ${verifactuNoticeHtml}
    </div>
  </div>
</body>
</html>
  `.trim();
};

/**
 * Obtiene todos los datos necesarios y genera el PDF multi-pagina
 */
export const generarPdfFactura = async (facturaId, options = {}) => {
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${facturaId}`;
  if (!factura) throw new Error('Factura no encontrada');

  const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id = ${factura.empresa_id} LIMIT 1`;
  if (!emisor) throw new Error('No hay emisor configurado');

  const [config] = await sql`SELECT * FROM configuracionsistema_180 WHERE empresa_id = ${factura.empresa_id} LIMIT 1`;

  const [cliente] = await sql`
    SELECT c.*, f.razon_social, f.nif_cif, f.direccion_fiscal, f.municipio, f.codigo_postal, f.provincia as prov_fiscal
    FROM clients_180 c
    LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
    WHERE c.id = ${factura.cliente_id}
  `;
  if (!cliente) throw new Error('Cliente no encontrado');

  const lineas = await sql`SELECT * FROM lineafactura_180 WHERE factura_id = ${facturaId} ORDER BY id ASC`;
  if (!lineas?.length) throw new Error('La factura no tiene líneas');

  const html = await generarHtmlFactura(factura, emisor, cliente, lineas, config, options);

  // Header/footer running para todas las paginas con numeracion
  const emisorNombre = (emisor.nombre || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const facturaNumero = (factura.numero || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  let cleanTextoPie = emisor.texto_pie || '';
  if (cleanTextoPie.includes("Veri*Factu")) {
    cleanTextoPie = cleanTextoPie.replace(/Factura emitida bajo el sistema Veri\*Factu de la AEAT\.\s*/g, '');
    cleanTextoPie = cleanTextoPie.replace(/Gracias por su confianza\./g, '');
  }
  const footerLeft = cleanTextoPie.trim().substring(0, 60).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const pdfBuffer = await generatePdf(html, {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%;font-size:8px;padding:2mm 10mm;display:flex;justify-content:space-between;color:#999;font-family:Helvetica,Arial,sans-serif;">
        <span>${emisorNombre}</span>
        <span>Factura ${facturaNumero}</span>
      </div>
    `,
    footerTemplate: `
      <div style="width:100%;font-size:8px;padding:2mm 10mm;display:flex;justify-content:space-between;color:#999;font-family:Helvetica,Arial,sans-serif;">
        <span>${footerLeft}</span>
        <span>P&aacute;gina <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>
    `,
    margin: {
      top: '12mm',
      right: '0px',
      bottom: '15mm',
      left: '0px',
    },
  });

  return pdfBuffer;
};

/**
 * Wrapper legado
 */
export const generarYGuardarPdfFactura = async (facturaId, rutaDestino, options = {}) => {
  return await generarPdfFactura(facturaId, options);
};
