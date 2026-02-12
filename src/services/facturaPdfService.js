import { sql } from '../db.js';
import { generatePdf } from './exportService.js';
import QRCode from 'qrcode';
import { construirUrlQr } from './verifactuService.js';
import path from 'path';
import fs from 'fs';

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

  /* LOGO INDEPENDIENTE - ARRIBA A LA IZQUIERDA */
  .logo-block {
    position: absolute;
    top: 20pt;
    left: 30pt;
  }

  .logo-img {
    max-width: 100pt;
    max-height: 70pt;
    display: block;
  }

  /* BLOQUE EMISOR - alto - 100pts (ALINEADO CON CLIENTE) */
  .emisor-block {
    position: absolute;
    top: 100pt;
    left: 30pt; /* margen_x = 30 */
    width: 250pt;
    text-align: left;
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

  /* BLOQUE METADATA (FECHA/NUMERO) - ARRIBA A LA DERECHA (ENCIMA DE CLIENTE) */
  .meta-block {
    position: absolute;
    top: 60pt; 
    left: calc(50% + 100pt); 
    width: calc(50% - 110pt); 
    text-align: left;
    font-weight: bold;
    font-size: 11pt;
  }
  .meta-block div { margin-bottom: 4pt; }

  /* BLOQUE CLIENTE - ALINEADO CON EMISOR */
  .cliente-block {
    position: absolute;
    top: 100pt; 
    left: calc(50% + 100pt); 
    width: calc(50% - 110pt); 
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
    padding-top: 340pt; 
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
    top: 178pt; /* Alineado exacto con la línea de 'Nº FACTURA' */
    left: 50%;
    transform: translateX(-50%);
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
    font-size: 8pt;
    margin-top: 5pt;
    color: #000;
    line-height: 1.1;
    font-weight: bold;
    text-transform: uppercase;
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
    bottom: 90pt; /* Ajustado para estar entre los totales y el pie legal */
    left: 30pt;
    right: 30pt;
    font-style: italic;
    font-size: 10pt;
    line-height: 1.2;
    z-index: 10;
  }

  /* LEGAL / PIE - y_legal = 50pts */
  .legal-block {
    position: absolute;
    bottom: 30pt;
    left: 30pt;
    right: 30pt;
    font-size: 9pt;
    color: #444;
    border-top: 0.5pt solid #eee;
    padding-top: 5pt;
  }
  .thanks-msg {
    margin-bottom: 5pt;
    font-weight: bold;
    color: #000;
  }
  .verifactu-notice {
    position: absolute;
    bottom: 75pt;
    left: 30pt;
    right: 30pt;
    font-size: 8.5pt;
    color: #555;
    text-align: left;
    font-style: italic;
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
    try {
      let src = '';
      const logo = emisor.logo_path;

      // Caso 1: Data URI completo o URL externa
      if (logo.startsWith('data:') || logo.startsWith('http')) {
        src = logo;
      }
      // Caso 2: Raw Base64 (detectamos si es muy largo y no tiene caracteres de ruta)
      else if (logo.length > 100 && !logo.includes('/') && !logo.includes('\\')) {
        src = `data:image/png;base64,${logo}`;
      }
      // Caso 3: Ruta de archivo
      else {
        const cleanPath = logo.replace(/^\//, '').replace(/^api\/uploads\//, '');
        const fsPath = path.join(process.cwd(), 'uploads', cleanPath);

        if (fs.existsSync(fsPath)) {
          const imgData = fs.readFileSync(fsPath).toString('base64');
          const ext = path.extname(fsPath).substring(1) || 'png';
          src = `data:image/${ext};base64,${imgData}`;
        } else {
          // Último recurso: intentar URL de la API
          src = `http://localhost:5000/api/uploads/${cleanPath}`;
        }
      }
      logoHtml = `<img src="${src}" class="logo-img" />`;
    } catch (e) {
      console.error("❌ [PDF] Error procesando logo:", e);
    }
  }

  // 2. QR Code y Aviso Veri*Factu
  let qrHtml = '';
  let verifactuNoticeHtml = '';
  const verifactuText = "Factura emitida bajo el sistema Veri*Factu de la AEAT. Gracias por su confianza.";

  if (config && config.verifactu_activo) {
    verifactuNoticeHtml = `<div class="verifactu-notice">${verifactuText}</div>`;

    if (factura.verifactu_hash) {
      try {
        const urlQr = construirUrlQr(factura, emisor, config, (config.verifactu_modo === 'TEST' ? 'PRUEBAS' : 'PRODUCCION'));
        const qrDataUrl = await QRCode.toDataURL(urlQr, { margin: 0, errorCorrectionLevel: 'M' });
        qrHtml = `
              <div class="qr-block">
                  <img src="${qrDataUrl}" class="qr-img" />
                  <div class="verifactu-label">SISTEMA DE FACTURACIÓN VERIFICABLE</div>
              </div>
          `;
      } catch (err) {
        console.error("Error generando QR:", err);
      }
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

  // 6. Pie de Página Personalizado y Pago
  const ibanEmisor = emisor.cuenta_bancaria || emisor.iban || '';
  const metodoPago = factura.metodo_pago || 'TRANSFERENCIA'; // Default o desde factura

  let pagoHtml = '';
  if (metodoPago === 'CONTADO') {
    pagoHtml = 'Forma de pago: Al contado / Efectivo';
  } else if (ibanEmisor) {
    pagoHtml = `Forma de pago: Transferencia bancaria<br>IBAN: ${ibanEmisor}`;
  } else {
    pagoHtml = 'Forma de pago: Transferencia bancaria';
  }

  // Limpiar texto de VeriFactu del pie si ya está ahí para evitar duplicados o que aparezca cuando está desactivado
  let cleanTextoPie = emisor.texto_pie || '';
  if (cleanTextoPie.includes("Veri*Factu")) {
    // Si el sistema está desactivado o si vamos a poner el aviso automático, lo quitamos del pie guardado
    cleanTextoPie = cleanTextoPie.replace(/Factura emitida bajo el sistema Veri\*Factu de la AEAT\.\s*/g, '');
    cleanTextoPie = cleanTextoPie.replace(/Gracias por su confianza\./g, ''); // Limpiamos el gracias si venía con el combo de Verifactu
  }

  const pieContent = `
    <div class="thanks-msg">¡Gracias por su confianza!</div>
    ${pagoHtml}<br>
    ${cleanTextoPie.trim()}
  `;

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

    <div class="logo-block">
        ${logoHtml}
    </div>

    <div class="emisor-block">
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
    ${verifactuNoticeHtml}

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
