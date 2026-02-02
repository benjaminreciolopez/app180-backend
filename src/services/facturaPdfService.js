import { sql } from '../db.js';
import { generatePdf } from './exportService.js';
import QRCode from 'qrcode';
import { construirUrlQr } from './verifactuService.js';

/**
 * Estilos base para el PDF de factura - REPLICA EXACTA DE REPORTLAB
 * Basado en C:\Users\benja\Desktop\facturacion_app\app\services\facturas_pdf.py
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
    width: 210mm;
    height: 297mm;
    position: relative;
    -webkit-print-color-adjust: exact;
  }

  /* Conversión de puntos ReportLab a pixels/mm aproximados */
  /* ReportLab 1pt = 1/72 inch. A4 = 595x842 pts */
  
  .page-container {
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    position: relative;
  }

  /* MARCA DE AGUA TEST */
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(45deg);
    font-size: 40pt; /* c.setFont("Helvetica-Bold", 40) */
    font-weight: bold;
    color: rgba(230, 230, 230, 0.5);
    z-index: -1;
    pointer-events: none;
    white-space: nowrap;
    text-transform: uppercase;
  }

  /* TÍTULO - alto - 60pts */
  .header-title {
    position: absolute;
    top: 60pt; 
    left: 0;
    width: 100%;
    text-align: center;
    font-weight: bold;
    font-size: 22pt; /* c.setFont("Helvetica-Bold", 22) */
    text-transform: uppercase;
  }

  /* BLOQUE EMISOR - alto - 100pts base */
  .emisor-block {
    position: absolute;
    top: 100pt;
    left: 30pt; /* margen_x = 30 */
    width: 250pt;
    text-align: left;
  }

  .logo-img {
    max-width: 100pt;
    max-height: 80pt;
    margin-bottom: 10pt;
    display: block;
  }

  .emisor-nombre {
    font-size: 12pt;
    font-weight: bold;
    margin-bottom: 4pt;
  }

  .emisor-details {
    font-size: 10pt;
    line-height: 1.2;
  }

  /* BLOQUE METADATA - alto - 160pts */
  .meta-block {
    position: absolute;
    top: 160pt;
    right: 30pt;
    text-align: right;
    font-weight: bold;
    font-size: 11pt;
  }
  .meta-block div { margin-bottom: 4pt; }

  /* BLOQUE CLIENTE - alto - 200pts, x_cliente = ancho/2 + 80 */
  .cliente-block {
    position: absolute;
    top: 200pt;
    left: calc(50% + 80pt); 
    width: calc(50% - 110pt); /* 30pt margin right equivalent */
    text-align: left;
  }

  .cliente-label {
    font-weight: bold;
    font-size: 11pt;
    margin-bottom: 4pt;
  }

  .cliente-data {
    font-size: 10pt;
    line-height: 1.2;
  }

  /* TABLA DE LÍNEAS */
  /* El punto de inicio en el original es dinámico, aquí usaremos un margen top seguro */
  .table-container {
    padding-top: 320pt; 
    padding-left: 30pt;
    padding-right: 30pt;
  }

  table.lineas-table {
    width: 100%;
    border-collapse: collapse;
  }

  thead th {
    font-weight: bold;
    font-size: 10pt;
    text-align: left;
    padding-bottom: 8pt;
    border-bottom: 1pt solid #000;
  }

  tbody td {
    padding: 8pt 0;
    font-size: 9pt;
    vertical-align: top;
    border-bottom: 0.5pt solid #eee;
  }

  /* Anchos basados en Python positions */
  .col-cant { width: 45pt; text-align: center; }
  .col-desc { width: auto; text-align: left; padding-left: 15pt; }
  .col-price { width: 80pt; text-align: right; }
  .col-iva { width: 50pt; text-align: center; } /* Añadida pero compacta */
  .col-total { width: 80pt; text-align: right; }

  /* QR - qr_y = y_totales + (qr_size / 2) -> y_totales = 140. bottom-up */
  /* En CSS 'bottom' se ajusta mejor a la lógica ReportLab de y-coordinada 0 en el suelo */
  .qr-block {
    position: absolute;
    top: 130pt; /* Bajado un poco */
    left: 50%;
    transform: translateX(-50%); /* Centrado exacto horizontal */
    width: 140pt;
    text-align: center;
  }
  .qr-img {
    width: 28mm;
    height: 28mm;
    display: block;
    margin: 0 auto;
  }
  .verifactu-label {
    font-size: 7pt;
    margin-top: 4pt;
    color: #444;
    line-height: 1.1;
  }

  /* TOTALES - y_totales = 140pts desde abajo */
  .totals-block {
    position: absolute;
    bottom: 100pt;
    right: 30pt;
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

  /* MENSAJE IVA - y_iva_msg = 80pts */
  .mensaje-iva-block {
    position: absolute;
    bottom: 80pt;
    left: 30pt;
    right: 30pt;
    font-style: italic;
    font-size: 10pt;
    line-height: 1.2;
  }

  /* LEGAL / PIE - y_legal = 50pts */
  .legal-block {
    position: absolute;
    bottom: 40pt;
    left: 30pt;
    right: 30pt;
    font-size: 9pt;
    color: #333;
  }

</style>
`;

/**
 * Genera el HTML de una factura recreando EXACTAMENTE el diseño ReportLab de Python
 */
export const generarHtmlFactura = async (factura, emisor, cliente, lineas, config, options = {}) => {
  const { incluirMensajeIva = true } = options;

  const esRectificativa = String(factura.numero).endsWith('R');
  const titulo = esRectificativa ? 'FACTURA RECTIFICATIVA' : 'FACTURA';

  // Lógica marca de agua: Solo VeriFactu activo + Modo TEST
  const isTest = config && config.verifactu_activo && config.verifactu_modo === 'TEST';

  // 1. Logo
  let logoHtml = '';
  if (emisor.logo_path) {
    const src = emisor.logo_path.startsWith('http') || emisor.logo_path.startsWith('data:')
      ? emisor.logo_path
      : `/api/uploads/${emisor.logo_path.replace(/^\//, '')}`;
    logoHtml = `<img src="${src}" class="logo-img" />`;
  }

  // 2. QR Code
  let qrHtml = '';
  if (config && config.verifactu_activo && factura.verifactu_hash) {
    try {
      const urlQr = construirUrlQr(factura, emisor, config, (config.verifactu_modo === 'TEST' ? 'PRUEBAS' : 'PRODUCCION'));
      const qrDataUrl = await QRCode.toDataURL(urlQr, { margin: 0, errorCorrectionLevel: 'M' });
      qrHtml = `
            <div class="qr-block">
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

  // Desglose de IVA por tipos
  const desgloseIva = lineas.reduce((acc, l) => {
    const pct = Number(l.iva_percent || ivaGlobal);
    const base = Number(l.cantidad) * Number(l.precio_unitario);
    const cuota = base * (pct / 100);

    if (!acc[pct]) {
      acc[pct] = { base: 0, cuota: 0 };
    }
    acc[pct].base += base;
    acc[pct].cuota += cuota;
    return acc;
  }, {});

  // 4. Address Formats
  const fmtDir = (obj, pfx = '') => {
    const p1 = obj[`${pfx}direccion`] || '';
    const p2 = `${obj[`${pfx}codigo_postal`] || obj[`${pfx}cp`] || ''} ${obj[`${pfx}municipio`] || obj[`${pfx}poblacion`] || ''}`.trim();
    const p3 = `${obj[`${pfx}provincia`] || obj[`${pfx}prov_fiscal`] || ''} ${obj[`${pfx}pais`] || ''}`.trim();
    return [p1, p2, p3].filter(Boolean).join('<br>');
  };

  const emisorAddress = fmtDir(emisor);
  const clienteNombre = cliente.razon_social || cliente.nombre || '';
  const clienteAddress = fmtDir(cliente);

  // 5. Lines Row with IVA column
  const lineasHtml = lineas.map(l => `
      <tr>
        <td class="col-cant">${Number(l.cantidad).toFixed(2)}</td>
        <td class="col-desc">${l.descripcion || ''}</td>
        <td class="col-price">${Number(l.precio_unitario).toFixed(2)} €</td>
        <td class="col-iva">${Number(l.iva_percent || ivaGlobal).toFixed(2)}%</td>
        <td class="col-total">${Number(l.total).toFixed(2)} €</td>
      </tr>
  `).join('');

  // 6. Bank/PIE
  const pieContent = [
    emisor.texto_pie,
    (emisor.cuenta_bancaria || emisor.iban) ? `Cuenta Bancaria: ${emisor.cuenta_bancaria || emisor.iban}` : ''
  ].filter(Boolean).join('<br>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${FACTURA_STYLES}
</head>
<body>
  <div class="page-container">
    
    ${isTest ? '<div class="watermark">ENTORNO DE PRUEBAS</div>' : ''}

    <div class="header-title">${titulo}</div>

    <div class="emisor-block">
        ${logoHtml}
        <div class="emisor-nombre">${emisor.nombre || ''}</div>
        <div class="emisor-details">
            ${emisorAddress}<br>
            ${emisor.nif ? `CIF: ${emisor.nif}<br>` : ''}
            ${emisor.telefono ? `Tel: ${emisor.telefono}<br>` : ''}
            ${emisor.email ? `Email: ${emisor.email}` : ''}
        </div>
    </div>

    <div class="meta-block">
        <div>Fecha: ${new Date(factura.fecha).toLocaleDateString('es-ES')}</div>
        <div>Nº FACTURA: ${factura.numero}</div>
    </div>

    <div class="cliente-block">
        <div class="cliente-label">Datos del cliente:</div>
        <div class="cliente-data">
            <strong>${clienteNombre}</strong><br>
            ${cliente.nif_cif || cliente.nif ? `NIF: ${cliente.nif_cif || cliente.nif}<br>` : ''}
            ${clienteAddress}
        </div>
    </div>

    <div class="table-container">
        <table class="lineas-table">
            <thead>
                <tr>
                    <th class="col-cant">CANT.</th>
                    <th class="col-desc">DESCRIPCIÓN</th>
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

    ${qrHtml}

    <div class="totals-block">
        <div class="total-row">Subtotal: ${subtotal.toFixed(2)} €</div>
        ${Object.entries(desgloseIva).map(([pct, data]) => `
            <div class="total-row">IVA (${pct}%): ${data.cuota.toFixed(2)} €</div>
        `).join('')}
        <div class="total-row total-final">TOTAL FACTURA: ${total.toFixed(2)} €</div>
    </div>

    ${factura.mensaje_iva ? `
    <div class="mensaje-iva-block">
        ${factura.mensaje_iva}
    </div>` : ''}

    <div class="legal-block">
        ${pieContent}
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
