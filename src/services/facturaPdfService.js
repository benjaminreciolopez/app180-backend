import { sql } from '../db.js';
import { generatePdf } from './exportService.js';
import QRCode from 'qrcode';
import { construirUrlQr } from './verifactuService.js';

/**
 * Estilos base para el PDF de factura (Recreando estilo ReportLab)
 */
const FACTURA_STYLES = `
<style>
  @page {
    margin: 0;
    size: A4;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica', Arial, sans-serif;
    color: #000;
    margin: 0;
    padding: 0;
    font-size: 11px;
    -webkit-print-color-adjust: exact;
  }

  .page-container {
    padding: 30mm 15mm; /* ~85px top/bottom, ~40px side (adjusting to margen_x=30) */
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
  }

  /* MARCA DE AGUA TEST */
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(45deg);
    font-size: 60px;
    font-weight: bold;
    color: rgba(230, 230, 230, 0.5);
    z-index: 0;
    pointer-events: none;
    white-space: nowrap;
    text-transform: uppercase;
  }

  /* HEADER */
  .header-title {
    text-align: center;
    font-weight: bold;
    font-size: 24px;
    margin-bottom: 40px;
    text-transform: uppercase;
  }

  /* Layout Columns */
  .top-section {
    display: flex;
    justify-content: space-between;
    margin-bottom: 30px;
  }

  .left-col {
    width: 50%;
  }

  .right-col {
    width: 48%; /* Slightly wider for the two boxes */
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }

  /* LOGO */
  .logo-img {
    max-width: 120px;
    max-height: 80px;
    margin-bottom: 15px;
    display: block;
  }

  /* DATOS EMISOR */
  .emisor-data {
    font-size: 10px;
    line-height: 1.4;
  }
  .emisor-nombre {
    font-size: 12px;
    font-weight: bold;
    margin-bottom: 5px;
  }

  /* DATOS FACTURA (Top Right) */
  .factura-meta {
    font-size: 11px;
    font-weight: bold;
    margin-bottom: 40px; /* Space between meta and client box */
  }
  .factura-meta div {
    margin-bottom: 5px;
  }

  /* DATOS CLIENTE */
  .cliente-box {
    text-align: left;
    width: 100%;
    font-size: 10px;
    line-height: 1.3;
  }
  .cliente-label {
    font-weight: bold;
    font-size: 11px;
    margin-bottom: 5px;
  }
  .cliente-nombre {
    font-size: 11px;
    font-weight: bold;
  }
  
  /* TABLA */
  table.lineas-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 40px;
    margin-bottom: 30px;
  }
  
  thead th {
    font-weight: bold;
    font-size: 10px;
    text-align: left;
    padding-bottom: 8px;
    border-bottom: 1px solid #000;
  }
  
  tbody td {
    padding: 10px 0;
    font-size: 9px;
    vertical-align: top;
  }
  /* Borde sutil entre líneas */
  tbody tr:not(:last-child) td {
    border-bottom: 0.5px solid #eee;
  }

  .col-cant { width: 10%; text-align: left; padding-left: 5px; }
  .col-desc { width: 55%; text-align: left; }
  .col-price { width: 15%; text-align: right; }
  .col-total { width: 20%; text-align: right; padding-right: 5px; }

  /* TOTALES Y QR */
  .bottom-section {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
    page-break-inside: avoid;
  }

  .totals-box {
    width: 300px;
    text-align: right;
    font-size: 11px;
    font-weight: bold;
  }

  .totals-row {
    margin-bottom: 10px;
  }
  
  .total-final {
    font-size: 13px;
    margin-top: 15px;
    padding-top: 10px;
    border-top: 1.5px solid #000;
  }

  /* QR CODE */
  .qr-section {
    margin-bottom: 20px;
    display: flex; 
    flex-direction: column;
    align-items: flex-end;
  }
  .qr-img {
    width: 35mm; /* AEAT recommended size */
    height: 35mm;
  }
  .verifactu-label {
    font-size: 8px;
    margin-top: 5px;
    font-weight: normal;
  }

  /* LEGAL FOOTER (Bottom Section) */
  .legal-section {
    margin-top: 60px;
    page-break-inside: avoid;
    font-size: 9px;
    line-height: 1.4;
  }
  
  .mensaje-iva {
    font-style: italic;
    font-size: 10px;
    margin-bottom: 15px;
    border-left: 2px solid #000;
    padding-left: 10px;
  }

  .emisor-footer {
    color: #444;
  }

  /* BANK ACCOUNT */
  .cuenta-bancaria {
    margin-top: 10px;
    font-weight: bold;
    color: #111;
  }

</style>
`;

/**
 * Genera el HTML de una factura recreando el diseño Python / ReportLab
 */
export const generarHtmlFactura = async (factura, emisor, cliente, lineas, config, options = {}) => {
  const { incluirMensajeIva = true } = options;

  const esRectificativa = String(factura.numero).endsWith('R');
  const titulo = esRectificativa ? 'FACTURA RECTIFICATIVA' : 'FACTURA';

  const isTest = config && (config.verifactu_modo === 'TEST');

  // 1. Prepare Logo
  let logoHtml = '';
  if (emisor.logo_path) {
    const src = emisor.logo_path.startsWith('http') || emisor.logo_path.startsWith('data:')
      ? emisor.logo_path
      : `/api/uploads/${emisor.logo_path.replace(/^\//, '')}`;
    logoHtml = `<img src="${src}" class="logo-img" />`;
  }

  // 2. Prepare QR Code if VeriFactu is active
  let qrHtml = '';
  if (config && config.verifactu_activo && factura.verifactu_hash) {
    try {
      const urlQr = construirUrlQr(factura, emisor, config, isTest ? 'PRUEBAS' : 'PRODUCCION');
      const qrDataUrl = await QRCode.toDataURL(urlQr, { margin: 0, errorCorrectionLevel: 'M' });
      qrHtml = `
            <div class="qr-section">
                <img src="${qrDataUrl}" class="qr-img" />
                <div class="verifactu-label">Sistema de Facturación Verificable (Veri*Factu)</div>
            </div>
        `;
    } catch (err) {
      console.error("Error generando QR:", err);
    }
  }

  // 3. Totals
  const subtotal = Number(factura.subtotal || 0);
  const total = Number(factura.total || 0);
  const ivaGlobal = Number(factura.iva_global || 0);
  const ivaTotal = Number(factura.iva_total || 0);

  // 4. Emisor Address
  const direccionEmisorParts = [
    emisor.direccion,
    [emisor.cp, emisor.poblacion].filter(Boolean).join(' '),
    [emisor.provincia, emisor.pais].filter(Boolean).join(' ')
  ].filter(Boolean);
  const direccionEmisorHtml = direccionEmisorParts.join('<br>');

  // 5. Cliente Data (Priority to Fiscal)
  const clienteNombre = cliente.razon_social || cliente.nombre || '';
  const clienteNif = cliente.nif_cif || cliente.nif || '';
  const clienteDireccionParts = [
    cliente.direccion_fiscal || cliente.direccion,
    [cliente.codigo_postal || cliente.cp, cliente.municipio || cliente.poblacion].filter(Boolean).join(' '),
    [cliente.prov_fiscal || cliente.provincia, cliente.pais].filter(Boolean).join(' ')
  ].filter(Boolean);
  const direccionClienteHtml = clienteDireccionParts.join('<br>');

  // 6. Lines HTML
  const lineasHtml = lineas.map(l => `
      <tr>
        <td class="col-cant">${Number(l.cantidad).toFixed(2)}</td>
        <td class="col-desc">${l.descripcion || ''}</td>
        <td class="col-price">${Number(l.precio_unitario).toFixed(2)} €</td>
        <td class="col-total">${Number(l.total).toFixed(2)} €</td>
      </tr>
  `).join('');

  // 7. Mensaje IVA
  let mensajeIvaHtml = '';
  if (incluirMensajeIva && factura.mensaje_iva) {
    mensajeIvaHtml = `<div class="mensaje-iva">${factura.mensaje_iva}</div>`;
  }

  // 8. Bank Account
  let bancoHtml = '';
  if (emisor.cuenta_bancaria || emisor.iban) {
    bancoHtml = `<div class="cuenta-bancaria">Cuenta Bancaria: ${emisor.cuenta_bancaria || emisor.iban}</div>`;
  }

  // 9. Render
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${titulo} ${factura.numero}</title>
  ${FACTURA_STYLES}
</head>
<body>
  
  <div class="page-container">
    
    ${isTest ? '<div class="watermark">ENTORNO DE PRUEBAS</div>' : ''}

    <div class="header-title">${titulo}</div>

    <div class="top-section">
      
      <!-- LEFT: LOGO + EMISOR -->
      <div class="left-col">
        ${logoHtml}
        
        <div class="emisor-data">
            <div class="emisor-nombre">${emisor.nombre || 'Emisor'}</div>
            ${direccionEmisorHtml}<br>
            ${emisor.nif ? `CIF: ${emisor.nif}<br>` : ''}
            ${emisor.telefono ? `Tel: ${emisor.telefono}<br>` : ''}
            ${emisor.email ? `Email: ${emisor.email}<br>` : ''}
        </div>
      </div>

      <!-- RIGHT: META + CLIENTE -->
      <div class="right-col">
          <div class="factura-meta">
              <div>Fecha: ${new Date(factura.fecha).toLocaleDateString('es-ES')}</div>
              <div>Nº FACTURA: ${factura.numero}</div>
          </div>

          <div class="cliente-box">
              <div class="cliente-label">Datos del cliente:</div>
              <div class="cliente-nombre">${clienteNombre}</div>
              ${clienteNif ? `<div>NIF: ${clienteNif}</div>` : ''}
              <div>${direccionClienteHtml}</div>
          </div>
      </div>

    </div>

    <!-- TABLE -->
    <table class="lineas-table">
        <thead>
            <tr>
                <th class="col-cant">CANT.</th>
                <th class="col-desc">DESCRIPCIÓN</th>
                <th class="col-price">P. UNIT.</th>
                <th class="col-total">TOTAL</th>
            </tr>
        </thead>
        <tbody>
            ${lineasHtml}
        </tbody>
    </table>

    <!-- TOTALS & QR -->
    <div class="bottom-section">
        <div class="totals-box">
            
            ${qrHtml}

            <div class="totals-row">
                Subtotal: ${subtotal.toFixed(2)} €
            </div>
            <div class="totals-row">
                IVA (${ivaGlobal.toFixed(2)}%): ${ivaTotal.toFixed(2)} €
            </div>
            <div class="totals-row total-final">
                TOTAL FACTURA: ${total.toFixed(2)} €
            </div>
        </div>
    </div>

    <!-- LEGAL FOOTER -->
    <div class="legal-section">
        ${mensajeIvaHtml}
        <div class="emisor-footer">
            ${emisor.texto_pie ? `<div>${emisor.texto_pie}</div>` : ''}
            ${bancoHtml}
        </div>
    </div>

  </div>

</body>
</html>
  `.trim();
};

/**
 * Obtiene todos los datos necesarios y genera el PDF
 */
export const generarPdfFactura = async (facturaId, options = {}) => {
  // 1. Fetch Factura
  const [factura] = await sql`SELECT * FROM factura_180 WHERE id = ${facturaId}`;
  if (!factura) throw new Error('Factura no encontrada');

  // 2. Fetch Emisor
  const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id = ${factura.empresa_id} LIMIT 1`;
  if (!emisor) throw new Error('No hay emisor configurado');

  // 3. Fetch Config
  const [config] = await sql`SELECT * FROM configuracionsistema_180 WHERE empresa_id = ${factura.empresa_id} LIMIT 1`;

  // 4. Fetch Cliente + Fiscal Data
  const [cliente] = await sql`
    SELECT c.*, f.razon_social, f.nif_cif, f.direccion_fiscal, f.municipio, f.codigo_postal, f.provincia as prov_fiscal
    FROM clients_180 c
    LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
    WHERE c.id = ${factura.cliente_id}
  `;
  if (!cliente) throw new Error('Cliente no encontrado');

  // 5. Fetch Lines
  const lineas = await sql`SELECT * FROM lineafactura_180 WHERE factura_id = ${facturaId} ORDER BY id ASC`;
  if (!lineas?.length) throw new Error('La factura no tiene líneas');

  // 6. Generate HTML
  const html = await generarHtmlFactura(factura, emisor, cliente, lineas, config, options);

  // 7. Convert to PDF
  const pdfBuffer = await generatePdf(html, {
    format: 'A4',
    printBackground: true,
    margin: {
      top: '0px',
      right: '0px',
      bottom: '0px',
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
