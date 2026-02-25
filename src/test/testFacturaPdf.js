/**
 * Script de testing para validar generación de PDF de facturas MULTI-PÁGINA
 * Usa datos REALES del emisor (con logo) y un cliente real de la base de datos.
 * Genera 4 variantes SIN alterar numeración real:
 *   1. 1 página, SIN VeriFactu
 *   2. 1 página, CON VeriFactu
 *   3. 2+ páginas, SIN VeriFactu
 *   4. 2+ páginas, CON VeriFactu
 *
 * Uso: node src/test/testFacturaPdf.js
 */

import { generarHtmlFactura } from '../services/facturaPdfService.js';
import { sql } from '../db.js';
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ─── HELPERS ────────────────────────────────────────────────

function generarHashPrueba(factura, hashAnterior = "") {
  const payload = {
    numero_factura: factura.numero,
    fecha_factura: factura.fecha,
    total_factura: factura.total,
    nif_emisor: factura.nif_emisor || '',
    nif_receptor: factura.nif_receptor || '',
    hash_anterior: hashAnterior
  };
  const canonico = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

// ─── LÍNEAS CORTAS (2 → 1 página) ──────────────────────────

const lineasCortas = [
  { id: 1, descripcion: 'Desarrollo software personalizado - Módulo de facturación con VeriFactu', cantidad: 80, precio_unitario: 10.00, subtotal: 800.00, iva_percent: 21, total: 968.00 },
  { id: 2, descripcion: 'Consultoría técnica y soporte - Integración con AEAT', cantidad: 10, precio_unitario: 20.00, subtotal: 200.00, iva_percent: 21, total: 242.00 },
];

// ─── LÍNEAS LARGAS (30 → 2+ páginas) ───────────────────────

const conceptosLargos = [
  'Diseño de base de datos PostgreSQL con RLS multi-tenant',
  'API REST con Express.js - Endpoints CRUD completos',
  'Integración con sistema VeriFactu de la AEAT',
  'Desarrollo frontend Next.js - Dashboard principal',
  'Módulo de fichajes con geolocalización GPS',
  'Sistema de hash encadenado SHA-256 (RD 8/2019)',
  'Panel de control horario con detección de anomalías',
  'Módulo de facturación electrónica con PDF multi-página',
  'Integración Google Calendar - Sincronización bidireccional',
  'Sistema de notificaciones en tiempo real',
  'Módulo de gestión de empleados y nóminas',
  'Generación automática de asientos contables (PGC PYMES)',
  'Portal de asesoría con mensajería integrada',
  'Exportación Excel/CSV/ZIP para asesor fiscal',
  'Módulo de compras y gastos con OCR integrado',
  'Balance de situación y cuenta de PyG automáticos',
  'Libro Mayor con filtros por cuenta y período',
  'Sistema de auditoría legal con trazabilidad completa',
  'Configuración de centros de trabajo con geofencing',
  'PWA móvil con pull-to-refresh y modo offline',
  'IA Copilot con 92 herramientas - Claude Haiku 4.5',
  'Clasificación contable automática con IA (batch)',
  'Detección inteligente de cuentas PGC por descripción',
  'Sistema de PIN lock y screensaver empresarial',
  'Módulo fiscal - Modelos tributarios automáticos',
  'Verificación de integridad de fichajes (CSV codes)',
  'Endpoint público de verificación con QR code',
  'Correcciones de fichaje con flujo de aprobación',
  'Multi-validación de asientos contables en lote',
  'Reporte de rentabilidad por cliente y proyecto',
];

const lineasLargas = conceptosLargos.map((desc, i) => {
  const cantidad = Math.floor(Math.random() * 20) + 1;
  const precio_unitario = parseFloat((Math.random() * 80 + 20).toFixed(2));
  const subtotal = cantidad * precio_unitario;
  const total = subtotal * 1.21;
  return { id: i + 1, descripcion: desc, cantidad, precio_unitario, subtotal, iva_percent: 21, total };
});

// ─── FACTURA BASE ───────────────────────────────────────────

function crearFactura(lineas, numero, emisorNif, clienteNif) {
  const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0);
  const iva = subtotal * 0.21;
  const total = subtotal + iva;
  return {
    id: 'TEST',
    numero,
    fecha: new Date('2026-02-25').toISOString(),
    fecha_vencimiento: new Date('2026-03-27').toISOString(),
    subtotal,
    iva_global: 21,
    iva_total: iva,
    total,
    estado: 'VALIDADA',
    metodo_pago: 'TRANSFERENCIA',
    verifactu_hash: '',
    verifactu_fecha_generacion: new Date().toISOString(),
    nif_emisor: emisorNif,
    nif_receptor: clienteNif,
    mensaje_iva: null,
  };
}

// ─── GENERAR PDF DIRECTAMENTE (sin exportService) ───────────

async function generarPdfDirecto(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: 'new',
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Spacer: rellenar espacio sobrante en la ultima pagina (1 pag y multi-pag)
    await page.evaluate(() => {
      const spacer = document.getElementById('invoice-spacer');
      if (!spacer) return;
      const mmToPx = 96 / 25.4;
      const usableH = 272 * mmToPx; // 297-5(top)-15(@page)-5(puppeteer bottom)
      const contentH = document.body.scrollHeight;
      const numPages = Math.ceil(contentH / usableH);
      const totalSpace = numPages * usableH;
      const gap = totalSpace - contentH;
      if (gap > 5) {
        spacer.style.height = gap + 'px';
      }
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;font-size:8px;padding:1mm 10mm;text-align:right;color:#999;font-family:Helvetica,Arial,sans-serif;">
          <span>P&aacute;gina <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        </div>
      `,
      margin: { top: '5mm', right: '0px', bottom: '5mm', left: '0px' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// ─── EJECUTAR ───────────────────────────────────────────────

async function ejecutarTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST DE FACTURA PDF MULTI-PAGINA (DATOS REALES)');
  console.log('='.repeat(60) + '\n');

  // 1. Obtener datos reales del emisor (con logo)
  console.log('Conectando a Supabase para obtener datos reales...');
  const [emisor] = await sql`SELECT * FROM emisor_180 LIMIT 1`;
  if (!emisor) {
    console.error('No se encontró emisor en la base de datos');
    process.exit(1);
  }
  console.log(`  Emisor: ${emisor.nombre} (NIF: ${emisor.nif})`);
  console.log(`  Logo: ${emisor.logo_path ? `SI (${emisor.logo_path.length} chars)` : 'NO'}`);

  // 2. Obtener un cliente real con datos fiscales
  const [cliente] = await sql`
    SELECT c.*, f.razon_social, f.nif_cif AS fiscal_nif, f.direccion_fiscal,
           f.municipio, f.codigo_postal, f.provincia AS prov_fiscal
    FROM clients_180 c
    LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
    WHERE c.empresa_id = ${emisor.empresa_id}
      AND f.razon_social IS NOT NULL
    LIMIT 1
  `;
  if (!cliente) {
    console.error('No se encontró cliente con datos fiscales');
    process.exit(1);
  }
  console.log(`  Cliente: ${cliente.razon_social || cliente.nombre}`);

  const desktopPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
  const resultados = [];

  const escenarios = [
    ['1pag_SIN_verifactu', lineasCortas,  false, 'F-2026-TEST1'],
    ['1pag_CON_verifactu', lineasCortas,  true,  'F-2026-TEST2'],
    ['2pag_SIN_verifactu', lineasLargas,  false, 'F-2026-TEST3'],
    ['2pag_CON_verifactu', lineasLargas,  true,  'F-2026-TEST4'],
  ];

  for (const [nombre, lineas, conVerifactu, numero] of escenarios) {
    console.log(`\n--- ${nombre} ---`);
    console.log(`    Lineas: ${lineas.length} | VeriFactu: ${conVerifactu ? 'SI' : 'NO'}`);

    const factura = crearFactura(lineas, numero, emisor.nif, cliente.nif_cif || cliente.nif);
    if (conVerifactu) {
      factura.verifactu_hash = generarHashPrueba(factura);
    }

    const config = {
      verifactu_activo: conVerifactu,
      verifactu_modo: 'TEST',
    };

    try {
      // 1. Generar HTML usando la funcion REAL del servicio con datos reales
      const html = await generarHtmlFactura(factura, emisor, cliente, lineas, config);

      // 2. Guardar HTML
      const htmlFile = `FACTURA_TEST_${nombre}.html`;
      const htmlPath = path.join(desktopPath, htmlFile);
      fs.writeFileSync(htmlPath, html, 'utf-8');
      console.log(`    HTML -> ${htmlFile}`);

      // 3. Intentar PDF
      try {
        const pdfBuffer = await generarPdfDirecto(html);
        const pdfFile = `FACTURA_TEST_${nombre}.pdf`;
        const pdfPath = path.join(desktopPath, pdfFile);
        fs.writeFileSync(pdfPath, pdfBuffer);
        const sizeKb = (pdfBuffer.length / 1024).toFixed(1);
        console.log(`    PDF -> ${pdfFile} (${sizeKb} KB)`);
        resultados.push({ nombre, html: true, pdf: true, size: sizeKb });
      } catch (pdfErr) {
        console.log(`    PDF -> FALLO (${pdfErr.message.substring(0, 80)})`);
        console.log(`    (Abre el HTML en el navegador para verificar el layout)`);
        resultados.push({ nombre, html: true, pdf: false, error: pdfErr.message.substring(0, 60) });
      }

    } catch (error) {
      console.error(`    ERROR TOTAL: ${error.message}`);
      resultados.push({ nombre, html: false, pdf: false, error: error.message });
    }
  }

  // Resumen
  console.log('\n' + '='.repeat(60));
  console.log('  RESUMEN');
  console.log('='.repeat(60));
  for (const r of resultados) {
    const htmlIcon = r.html ? 'OK' : 'FAIL';
    const pdfIcon = r.pdf ? `OK (${r.size} KB)` : 'FAIL';
    console.log(`  ${r.nombre.padEnd(25)} HTML: ${htmlIcon}  PDF: ${pdfIcon}`);
  }
  console.log('='.repeat(60));
  console.log(`\nArchivos en: ${desktopPath}\n`);

  console.log('Verificar en cada PDF/HTML:');
  console.log('  - Footer: "Pagina X de Y" (todas las paginas)');
  console.log('  - 1 pagina: totales anclados al fondo');
  console.log('  - 2+ paginas: totales anclados al fondo de la ultima pagina');
  console.log('  - VeriFactu: QR code + marca de agua "ENTORNO DE PRUEBAS"');
  console.log('  - Sin VeriFactu: sin QR, sin marca de agua');
  console.log('  - Cabeceras de tabla repetidas en cada pagina');
  console.log('  - Logo del emisor real visible');
  console.log('');
}

ejecutarTests().then(() => {
  console.log('Test completado.\n');
  process.exit(0);
}).catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
