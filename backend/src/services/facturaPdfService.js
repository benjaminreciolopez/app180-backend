import { sql } from '../db.js';
import { generatePdf } from './exportService.js';

/**
 * Estilos base para el PDF de factura
 */
const FACTURA_STYLES = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #333;
    line-height: 1.4;
    padding: 30px;
  }
  .titulo {
    text-align: center;
    font-size: 22px;
    font-weight: bold;
    text-transform: uppercase;
    margin-bottom: 30px;
    padding-bottom: 10px;
    border-bottom: 2px solid #eee;
  }
  .rectificativa { color: #dc2626; }
  .marca-test {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(45deg);
    font-size: 60px;
    font-weight: bold;
    color: rgba(200, 200, 200, 0.3);
    z-index: -1;
    white-space: nowrap;
  }
  .header-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-bottom: 30px;
  }
  .emisor, .cliente {
    padding: 15px;
    background: #fafafa;
    border-radius: 4px;
  }
  .emisor h3, .cliente h3 {
    font-size: 14px;
    margin-bottom: 10px;
    color: #111;
    border-bottom: 1px solid #ddd;
    padding-bottom: 5px;
  }
  .emisor p, .cliente p {
    font-size: 11px;
    margin: 4px 0;
    color: #555;
  }
  .logo {
    max-width: 150px;
    max-height: 80px;
    margin-bottom: 10px;
  }
  .meta-factura {
    text-align: right;
    margin-bottom: 20px;
    font-size: 11px;
  }
  .meta-factura strong { color: #111; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 11px;
  }
  thead {
    background: #f4f4f4;
    font-weight: bold;
  }
  th, td {
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #eee;
  }
  th { color: #111; font-size: 10px; text-transform: uppercase; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .totales {
    margin-top: 30px;
    float: right;
    width: 300px;
  }
  .totales .fila {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    font-size: 12px;
  }
  .totales .fila.total {
    font-weight: bold;
    font-size: 14px;
    border-top: 2px solid #333;
    margin-top: 10px;
    padding-top: 10px;
  }
  .footer {
    clear: both;
    margin-top: 60px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    font-size: 10px;
    color: #666;
  }
  .qr-container {
    text-align: center;
    margin-top: 30px;
  }
  .qr-container img {
    width: 100px;
    height: 100px;
  }
  .mensaje-iva {
    margin: 20px 0;
    padding: 10px;
    background: #fef3c7;
    border-left: 3px solid #f59e0b;
    font-size: 10px;
    font-style: italic;
  }
</style>
`;

/**
 * Genera el HTML de una factura
 * @param {object} factura - Datos de la factura
 * @param {object} emisor - Datos del emisor
 * @param {object} cliente - Datos del cliente
 * @param {Array} lineas - Líneas de la factura
 * @param {object} options - Opciones adicionales (incluirMensajeIva, modo)
 * @returns {string} HTML completo de la factura
 */
export const generarHtmlFactura = (factura, emisor, cliente, lineas, options = {}) => {
  const { incluirMensajeIva = true, modo = 'PROD' } = options;

  const esRectificativa = factura.numero && factura.numero.endsWith('R');
  const titulo = esRectificativa ? 'FACTURA RECTIFICATIVA' : 'FACTURA';
  const claseRectificativa = esRectificativa ? 'rectificativa' : '';

  // Textos legales dinámicos (usar los generados si existen)
  const textoPie = emisor.texto_pie || emisor.terminos_legales || "";
  const textoRectificativa = emisor.texto_rectificativa || "";
  const textoExento = emisor.texto_exento || "";

  const fechaFormateada = new Date(factura.fecha).toLocaleDateString('es-ES');

  // Logo del emisor (si existe)
  // emisor.logo_path guarda base64 o ruta
  let logoHtml = '';
  if (emisor.logo_path) {
    const src = emisor.logo_path.startsWith('data:') ? emisor.logo_path : `/api/uploads/${emisor.logo_path}`;
    logoHtml = `<img src="${src}" alt="Logo" class="logo">`;
  } else if (emisor.logo_url) {
    logoHtml = `<img src="${emisor.logo_url}" alt="Logo" class="logo">`;
  }

  // Dirección completa del emisor
  const direccionEmisor = [
    emisor.direccion,
    [emisor.cp, emisor.poblacion].filter(Boolean).join(' '),
    [emisor.provincia, emisor.pais].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join('<br>');

  // Dirección completa del cliente
  const direccionCliente = [
    cliente.direccion,
    [cliente.cp, cliente.poblacion].filter(Boolean).join(' '),
    [cliente.provincia, cliente.pais].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join('<br>');

  // Líneas de factura
  const lineasHtml = lineas
    .map(
      (linea) => {
        const base = Number(linea.cantidad) * Number(linea.precio_unitario);
        const ivaPct = Number(linea.iva_percent || factura.iva_global || 0);
        return `
          <tr>
            <td class="text-center">${Number(linea.cantidad).toFixed(2)}</td>
            <td>${linea.descripcion || ''}</td>
            <td class="text-right">${Number(linea.precio_unitario).toFixed(2)} €</td>
            <td class="text-center">${ivaPct}%</td>
            <td class="text-right">${base.toFixed(2)} €</td>
          </tr>
        `;
      }
    )
    .join('');

  // Totales
  const subtotalVal = Number(factura.subtotal || 0);
  const totalVal = Number(factura.total || 0);

  // Agrupar IVA para desglose
  const ivaGroups = lineas.reduce((acc, l) => {
    const pct = Number(l.iva_percent || factura.iva_global || 0);
    const base = Number(l.cantidad) * Number(l.precio_unitario);
    const cuota = base * (pct / 100);
    if (!acc[pct]) acc[pct] = 0;
    acc[pct] += cuota;
    return acc;
  }, {});

  const ivaDesgloseHtml = Object.entries(ivaGroups)
    .map(([pct, cuota]) => `
      <div class="fila">
        <span>IVA (${pct}%):</span>
        <span>${cuota.toFixed(2)} €</span>
      </div>
    `).join('');

  // Mensaje IVA
  let mensajeIvaHtml = '';
  if (incluirMensajeIva && factura.mensaje_iva) {
    mensajeIvaHtml = `
      <div class="mensaje-iva">
        ${factura.mensaje_iva}
      </div>
    `;
  } else if (incluirMensajeIva && factura.iva_total === 0 && textoExento) {
    mensajeIvaHtml = `
      <div class="mensaje-iva">
        ${textoExento}
      </div>
    `;
  } else if (esRectificativa && textoRectificativa) {
    mensajeIvaHtml = `
      <div class="mensaje-iva" style="background: #fef2f2; border-color: #ef4444;">
        ${textoRectificativa}
      </div>
    `;
  }

  // Marca de entorno de pruebas
  let marcaTestHtml = '';
  if (modo === 'TEST') {
    marcaTestHtml = '<div class="marca-test">ENTORNO DE PRUEBAS</div>';
  }

  // Footer legal
  let footerHtml = '';
  if (textoPie) {
    footerHtml = `<div class="footer">${textoPie}</div>`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${titulo} ${factura.numero || ''}</title>
  ${FACTURA_STYLES}
</head>
<body>
  ${marcaTestHtml}

  <div class="titulo ${claseRectificativa}">
    ${titulo}
  </div>

  <div class="meta-factura">
    <p><strong>Fecha:</strong> ${fechaFormateada}</p>
    <p><strong>Nº FACTURA:</strong> ${factura.numero || 'BORRADOR'}</p>
  </div>

  <div class="header-grid">
    <div class="emisor">
      ${logoHtml}
      <h3>Datos del emisor</h3>
      <p><strong>${emisor.nombre || ''}</strong></p>
      ${direccionEmisor ? `<p>${direccionEmisor}</p>` : ''}
      ${emisor.nif ? `<p><strong>CIF:</strong> ${emisor.nif}</p>` : ''}
      ${emisor.telefono ? `<p><strong>Tel:</strong> ${emisor.telefono}</p>` : ''}
      ${emisor.email ? `<p><strong>Email:</strong> ${emisor.email}</p>` : ''}
      ${emisor.web ? `<p><strong>Web:</strong> ${emisor.web}</p>` : ''}
    </div>

    <div class="cliente">
      <h3>Datos del cliente</h3>
      <p><strong>${cliente.nombre || ''}</strong></p>
      ${cliente.nif ? `<p><strong>NIF:</strong> ${cliente.nif}</p>` : ''}
      ${direccionCliente ? `<p>${direccionCliente}</p>` : ''}
      ${cliente.telefono ? `<p><strong>Tel:</strong> ${cliente.telefono}</p>` : ''}
      ${cliente.email ? `<p><strong>Email:</strong> ${cliente.email}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="text-center" style="width: 10%;">CANT.</th>
        <th style="width: 45%;">DESCRIPCIÓN</th>
        <th class="text-right" style="width: 15%;">P. UNIT.</th>
        <th class="text-center" style="width: 10%;">IVA %</th>
        <th class="text-right" style="width: 20%;">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${lineasHtml}
    </tbody>
  </table>

  ${mensajeIvaHtml}

  <div class="totales">
    <div class="fila">
      <span>Subtotal:</span>
      <span>${subtotalVal.toFixed(2)} €</span>
    </div>
    ${ivaDesgloseHtml}
    <div class="fila total">
      <span>TOTAL FACTURA:</span>
      <span>${totalVal.toFixed(2)} €</span>
    </div>
  </div>

  ${footerHtml}
</body>
</html>
  `.trim();
};

/**
 * Genera el PDF completo de una factura (orquestador)
 * @param {number} facturaId - ID de la factura
 * @param {object} options - Opciones adicionales
 * @returns {Promise<Buffer>} Buffer del PDF generado
 */
export const generarPdfFactura = async (facturaId, options = {}) => {
  // 1. Obtener datos de la factura
  const [factura] = await sql`
    SELECT * FROM factura_180
    WHERE id = ${facturaId}
  `;

  if (!factura) {
    throw new Error('Factura no encontrada');
  }

  // 2. Obtener emisor
  const [emisor] = await sql`
    SELECT * FROM emisor_180
    WHERE empresa_id = ${factura.empresa_id}
    LIMIT 1
  `;

  if (!emisor) {
    throw new Error('No hay emisor configurado para esta empresa');
  }

  // 3. Obtener cliente
  const [cliente] = await sql`
    SELECT * FROM clients_180
    WHERE id = ${factura.cliente_id}
  `;

  if (!cliente) {
    throw new Error('Cliente no encontrado');
  }

  // 4. Obtener líneas de factura
  const lineas = await sql`
    SELECT * FROM lineafactura_180
    WHERE factura_id = ${facturaId}
    ORDER BY id ASC
  `;

  if (!lineas || lineas.length === 0) {
    throw new Error('La factura no tiene líneas');
  }

  // 5. Generar HTML
  const html = generarHtmlFactura(factura, emisor, cliente, lineas, options);

  // 6. Convertir HTML a PDF usando exportService
  const pdfBuffer = await generatePdf(html, {
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px',
    },
  });

  return pdfBuffer;
};

/**
 * Genera y guarda el PDF de una factura en el sistema de archivos
 * @param {number} facturaId - ID de la factura
 * @param {string} rutaDestino - Ruta donde guardar el PDF
 * @param {object} options - Opciones adicionales
 * @returns {Promise<string>} Ruta del PDF generado
 */
export const generarYGuardarPdfFactura = async (facturaId, rutaDestino, options = {}) => {
  const pdfBuffer = await generarPdfFactura(facturaId, options);

  // Aquí podrías guardar el PDF en el filesystem o en cloud storage
  // Por ahora solo retornamos el buffer
  // En producción: fs.writeFileSync(rutaDestino, pdfBuffer);

  return pdfBuffer;
};
