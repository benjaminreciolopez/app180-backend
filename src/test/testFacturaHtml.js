/**
 * Script de testing para validar HTML de facturas
 * Genera un HTML que puedes abrir en el navegador para validar e imprimir como PDF
 *
 * Uso: node src/test/testFacturaHtml.js
 */

import QRCode from 'qrcode';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Función helper para generar hash VeriFactu de prueba
function generarHashPrueba(factura, hashAnterior = "") {
  const payload = {
    numero_factura: factura.numero,
    fecha_factura: factura.fecha,
    total_factura: factura.total,
    nif_emisor: factura.nif_emisor,
    nif_receptor: factura.nif_receptor,
    hash_anterior: hashAnterior
  };
  const canonico = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

// Función helper para construir URL QR de prueba
function construirUrlQrPrueba(factura, emisor, entorno = 'PRUEBAS') {
  const baseUrl = entorno === 'PRODUCCION'
    ? 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'
    : 'https://prewww2.aeat.es/wlpl/TIKE-CONT-PREWEB/ValidarQR';

  const params = new URLSearchParams({
    nif: emisor.nif_cif,
    num: factura.numero,
    fec: factura.fecha.split('T')[0].replace(/-/g, ''),
    imp: factura.total.toFixed(2)
  });

  return `${baseUrl}?${params.toString()}`;
}

// Datos de ejemplo - FACTURA DE PRUEBA
const datosEjemplo = {
  factura: {
    id: 'TEST-001',
    numero: 'F-2026-00001',
    fecha: new Date('2026-02-23').toISOString(),
    fecha_vencimiento: new Date('2026-03-25').toISOString(),
    subtotal: 1000.00,
    iva: 210.00,
    total: 1210.00,
    estado: 'VALIDADA',
    observaciones: 'Factura de prueba para validación del sistema PDF',
    forma_pago: 'Transferencia bancaria',
    verifactu_hash: '', // Se generará
    verifactu_fecha_generacion: new Date().toISOString(),
    nif_emisor: 'B12345678',
    nif_receptor: 'A87654321'
  },
  emisor: {
    nombre_comercial: 'CONTENDO GESTIONES SL',
    nombre_fiscal: 'CONTENDO GESTIONES SOCIEDAD LIMITADA',
    nif_cif: 'B12345678',
    direccion_fiscal: 'Calle Mayor, 123, 3º A',
    municipio: 'Madrid',
    codigo_postal: '28013',
    provincia: 'Madrid',
    telefono: '+34 912 345 678',
    email: 'info@contendo.es',
    web: 'www.contendo.es',
    iban: 'ES91 2100 0418 4502 0005 1332',
    registro_mercantil: 'Registro Mercantil de Madrid, Tomo 12345, Folio 67, Hoja M-234567',
    // Textos legales
    texto_pie: 'Gracias por confiar en CONTENDO GESTIONES. Para cualquier consulta, no dude en contactarnos.',
    texto_exento: null,
    texto_rectificativa: null,
    terminos_legales: 'Condiciones de pago: 30 días desde la fecha de factura. Interés de demora: 10% anual según Ley 3/2004.',
    mensaje_iva: 'IVA incluido según normativa vigente. Factura exenta de retención IRPF.'
  },
  cliente: {
    nombre: 'ACME CORPORATION SA',
    razon_social: 'ACME CORPORATION SOCIEDAD ANONIMA',
    nif_cif: 'A87654321',
    direccion_fiscal: 'Avenida de la Industria, 456',
    municipio: 'Barcelona',
    codigo_postal: '08001',
    prov_fiscal: 'Barcelona',
    email: 'facturacion@acme.example.com',
    telefono: '+34 934 567 890'
  },
  lineas: [
    {
      id: 1,
      descripcion: 'Desarrollo software personalizado - Módulo de facturación con VeriFactu',
      cantidad: 80,
      precio_unitario: 10.00,
      subtotal: 800.00,
      tipo_iva: 21,
      iva: 168.00,
      total: 968.00
    },
    {
      id: 2,
      descripcion: 'Consultoría técnica y soporte - Integración con AEAT',
      cantidad: 10,
      precio_unitario: 20.00,
      subtotal: 200.00,
      tipo_iva: 21,
      iva: 42.00,
      total: 242.00
    }
  ],
  config: {
    verifactu_activo: true,
    verifactu_modo: 'TEST', // Cambiar a 'PRODUCCION' para test de producción
    serie: 'F',
    storage_facturas_folder: 'Facturas emitidas',
    auditoria_activa: true
  }
};

// Generar hash VeriFactu
datosEjemplo.factura.verifactu_hash = generarHashPrueba(datosEjemplo.factura, "");

// Generar HTML de factura
async function generarHtmlFacturaPrueba(factura, emisor, cliente, lineas, config) {
  const isTest = config && config.verifactu_activo && config.verifactu_modo === 'TEST';

  // Generar QR Code
  let qrCodeDataUrl = '';
  let verifactuNoticeHtml = '';

  if (config && config.verifactu_activo && factura.verifactu_hash) {
    const urlQr = construirUrlQrPrueba(factura, emisor, config.verifactu_modo === 'TEST' ? 'PRUEBAS' : 'PRODUCCION');
    qrCodeDataUrl = await QRCode.toDataURL(urlQr, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 200,
      margin: 1
    });

    const verifactuText = "Factura emitida bajo el sistema Veri*Factu de la AEAT. Gracias por su confianza.";
    verifactuNoticeHtml = `<div class="verifactu-notice">${verifactuText}</div>`;
  }

  // Generar HTML
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Factura ${factura.numero} - VALIDACIÓN</title>
  <style>
    @page { margin: 0; size: A4; }
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
    .page-container { width: 100%; height: 100%; padding: 0; margin: 0; position: relative; }
    .watermark {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(45deg);
      font-size: 40pt; font-weight: bold; color: rgba(230, 230, 230, 0.5);
      z-index: -1; pointer-events: none; white-space: nowrap; text-transform: uppercase;
    }
    .header-title {
      position: absolute; top: 60pt; left: 0; width: 100%; text-align: center;
      font-weight: bold; font-size: 22pt; text-transform: uppercase;
    }
    .emisor-block { position: absolute; top: 100pt; left: 30pt; width: 210pt; text-align: left; }
    .emisor-nombre { font-size: 12pt; font-weight: bold; margin-bottom: 4pt; }
    .emisor-details { font-size: 10pt; line-height: 1.3; }
    .cliente-block { position: absolute; top: 100pt; right: 30pt; width: 230pt; text-align: left; }
    .cliente-nombre { font-size: 12pt; font-weight: bold; margin-bottom: 4pt; }
    .cliente-details { font-size: 10pt; line-height: 1.3; }
    .datos-factura-block {
      position: absolute; top: 220pt; right: 30pt; width: 230pt;
      border: 1pt solid #000; padding: 8pt;
    }
    .datos-row { display: flex; justify-content: space-between; margin-bottom: 4pt; font-size: 10pt; }
    .datos-label { font-weight: bold; }
    .lineas-table {
      position: absolute; top: 320pt; left: 30pt; right: 30pt;
      border-collapse: collapse; width: calc(100% - 60pt);
    }
    .lineas-table th {
      background-color: #e0e0e0; border: 1pt solid #000;
      padding: 8pt; font-size: 10pt; text-align: left;
    }
    .lineas-table td {
      border: 1pt solid #000; padding: 6pt; font-size: 10pt;
    }
    .lineas-table .text-right { text-align: right; }
    .totales-block {
      position: absolute; bottom: 180pt; right: 30pt; width: 200pt;
    }
    .totales-row {
      display: flex; justify-content: space-between; padding: 4pt 0;
      font-size: 11pt;
    }
    .totales-row.total-final { font-weight: bold; font-size: 13pt; border-top: 2pt solid #000; padding-top: 8pt; }
    .footer-legal {
      position: absolute; bottom: 80pt; left: 30pt; right: 30pt;
      font-size: 8pt; line-height: 1.3; color: #333;
      border-top: 1pt solid #ccc; padding-top: 8pt;
    }
    .verifactu-notice {
      position: absolute; bottom: 50pt; left: 30pt; right: 150pt;
      font-size: 9pt; font-weight: bold; color: #333;
    }
    .qr-block {
      position: absolute; bottom: 30pt; right: 30pt; text-align: center;
    }
    .qr-img { display: block; width: 100pt; height: 100pt; }
    .verifactu-label {
      font-size: 7pt; font-weight: bold; margin-top: 4pt;
      text-transform: uppercase; color: #666;
    }
    .hash-info { font-size: 6pt; color: #999; margin-top: 2pt; word-break: break-all; }

    /* Banner de instrucciones (solo visible en pantalla) */
    @media screen {
      .instrucciones-banner {
        position: fixed; top: 0; left: 0; right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white; padding: 15px;
        text-align: center; z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      .instrucciones-banner h3 { margin: 0 0 8px 0; font-size: 18px; }
      .instrucciones-banner p { margin: 0; font-size: 14px; opacity: 0.9; }
      body { margin-top: 100px; }
    }
    @media print {
      .instrucciones-banner { display: none; }
      body { margin-top: 0; }
    }
  </style>
</head>
<body>
  <!-- Banner de instrucciones (solo visible en pantalla) -->
  <div class="instrucciones-banner">
    <h3>✅ FACTURA DE PRUEBA GENERADA</h3>
    <p>
      Usa <strong>Ctrl+P</strong> o <strong>Cmd+P</strong> para imprimir a PDF •
      Verifica: QR, textos legales, hash VeriFactu, marca de agua TEST
    </p>
  </div>

  <div class="page-container">
    ${isTest ? '<div class="watermark">PRUEBAS · VERI*FACTU TEST</div>' : ''}

    <div class="header-title">FACTURA</div>

    <div class="emisor-block">
      <div class="emisor-nombre">${emisor.nombre_comercial || emisor.nombre_fiscal}</div>
      <div class="emisor-details">
        ${emisor.nombre_fiscal ? emisor.nombre_fiscal + '<br>' : ''}
        NIF: ${emisor.nif_cif}<br>
        ${emisor.direccion_fiscal}<br>
        ${emisor.codigo_postal} ${emisor.municipio} (${emisor.provincia})<br>
        ${emisor.telefono ? 'Tel: ' + emisor.telefono + '<br>' : ''}
        ${emisor.email ? emisor.email + '<br>' : ''}
        ${emisor.web ? emisor.web : ''}
      </div>
    </div>

    <div class="cliente-block">
      <div class="cliente-nombre">CLIENTE</div>
      <div class="cliente-details">
        <strong>${cliente.razon_social || cliente.nombre}</strong><br>
        NIF: ${cliente.nif_cif}<br>
        ${cliente.direccion_fiscal}<br>
        ${cliente.codigo_postal} ${cliente.municipio} (${cliente.prov_fiscal})
      </div>
    </div>

    <div class="datos-factura-block">
      <div class="datos-row">
        <span class="datos-label">Número:</span>
        <span>${factura.numero}</span>
      </div>
      <div class="datos-row">
        <span class="datos-label">Fecha:</span>
        <span>${new Date(factura.fecha).toLocaleDateString('es-ES')}</span>
      </div>
      <div class="datos-row">
        <span class="datos-label">Vencimiento:</span>
        <span>${new Date(factura.fecha_vencimiento).toLocaleDateString('es-ES')}</span>
      </div>
      <div class="datos-row">
        <span class="datos-label">Forma de pago:</span>
        <span>${factura.forma_pago || 'Transferencia'}</span>
      </div>
    </div>

    <table class="lineas-table">
      <thead>
        <tr>
          <th>Descripción</th>
          <th style="width: 60pt;">Cantidad</th>
          <th style="width: 70pt;">P. Unitario</th>
          <th style="width: 60pt;">IVA %</th>
          <th style="width: 80pt;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineas.map(linea => `
          <tr>
            <td>${linea.descripcion}</td>
            <td class="text-right">${linea.cantidad}</td>
            <td class="text-right">${linea.precio_unitario.toFixed(2)} €</td>
            <td class="text-right">${linea.tipo_iva}%</td>
            <td class="text-right">${linea.total.toFixed(2)} €</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totales-block">
      <div class="totales-row">
        <span>Subtotal:</span>
        <span>${factura.subtotal.toFixed(2)} €</span>
      </div>
      <div class="totales-row">
        <span>IVA (21%):</span>
        <span>${factura.iva.toFixed(2)} €</span>
      </div>
      <div class="totales-row total-final">
        <span>TOTAL:</span>
        <span>${factura.total.toFixed(2)} €</span>
      </div>
    </div>

    <div class="footer-legal">
      ${emisor.registro_mercantil ? emisor.registro_mercantil + '<br>' : ''}
      ${emisor.terminos_legales ? emisor.terminos_legales + '<br>' : ''}
      ${emisor.mensaje_iva ? emisor.mensaje_iva + '<br>' : ''}
      ${emisor.texto_pie ? emisor.texto_pie : ''}
    </div>

    ${verifactuNoticeHtml}

    ${qrCodeDataUrl ? `
      <div class="qr-block">
        <img src="${qrCodeDataUrl}" class="qr-img" alt="QR Veri*Factu" />
        <div class="verifactu-label">SISTEMA DE FACTURACIÓN VERIFICABLE</div>
        <div class="hash-info">Hash: ${factura.verifactu_hash}</div>
      </div>
    ` : ''}
  </div>
</body>
</html>
  `;

  return html;
}

// Ejecutar el test
async function ejecutarTest() {
  console.log('\n🧪 TEST DE GENERACIÓN HTML DE FACTURAS\n');
  console.log('📋 Datos de la factura de prueba:');
  console.log(`   Número: ${datosEjemplo.factura.numero}`);
  console.log(`   Cliente: ${datosEjemplo.cliente.razon_social}`);
  console.log(`   Total: ${datosEjemplo.factura.total.toFixed(2)} €`);
  console.log(`   VeriFactu: ${datosEjemplo.config.verifactu_activo ? 'ACTIVO' : 'INACTIVO'} (${datosEjemplo.config.verifactu_modo})`);
  console.log(`   Hash: ${datosEjemplo.factura.verifactu_hash.substring(0, 32)}...`);
  console.log('');

  try {
    // Generar HTML
    console.log('📝 Generando HTML...');
    const html = await generarHtmlFacturaPrueba(
      datosEjemplo.factura,
      datosEjemplo.emisor,
      datosEjemplo.cliente,
      datosEjemplo.lineas,
      datosEjemplo.config
    );

    // Guardar en Desktop
    const desktopPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
    const fileName = `FACTURA_TEST_${datosEjemplo.factura.numero.replace(/\//g, '-')}.html`;
    const outputPath = path.join(desktopPath, fileName);

    fs.writeFileSync(outputPath, html, 'utf8');

    console.log('');
    console.log('✅ HTML generado correctamente!');
    console.log(`📁 Ubicación: ${outputPath}`);
    console.log('');
    console.log('📖 INSTRUCCIONES:');
    console.log('   1. Abre el archivo HTML en tu navegador');
    console.log('   2. Usa Ctrl+P (Windows) o Cmd+P (Mac) para imprimir');
    console.log('   3. Selecciona "Guardar como PDF" como destino');
    console.log('   4. Configura los márgenes en "Ninguno"');
    console.log('   5. Guarda el PDF en tu Desktop');
    console.log('');
    console.log('🔍 Verificar:');
    console.log('   ✓ QR Code visible en esquina inferior derecha');
    console.log('   ✓ Textos legales completos en pie de página');
    console.log('   ✓ Hash VeriFactu completo bajo el QR');
    console.log('   ✓ Marca de agua "PRUEBAS · VERI*FACTU TEST" visible');
    console.log('   ✓ Formato A4 correcto (210mm x 297mm)');
    console.log('   ✓ Todos los datos legibles y bien posicionados');
    console.log('');

  } catch (error) {
    console.error('❌ Error generando HTML:', error);
    process.exit(1);
  }
}

// Ejecutar
ejecutarTest().then(() => {
  console.log('🎉 Test completado. Abre el HTML en tu Desktop para validar.\n');
  process.exit(0);
}).catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
