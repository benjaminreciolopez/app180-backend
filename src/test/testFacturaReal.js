import { sql } from '../db.js';
import { generarHtmlFactura } from '../services/facturaPdfService.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Script de prueba para validar generación de PDF de facturas con VeriFactu
 * - Usa código REAL de facturaPdfService.js
 * - Lee datos EXISTENTES de la BD (sin modificar nada)
 * - Simula VeriFactu activo en modo TEST (solo para visualización)
 * - Genera HTML en Desktop para validación manual
 */

async function testFacturaReal() {
  try {
    console.log('\n🧪 TEST DE GENERACIÓN PDF - USANDO CÓDIGO REAL\n');

    // 1. Buscar la factura más reciente de la BD
    console.log('📋 Buscando factura existente en la BD...');

    const [factura] = await sql`
      SELECT * FROM factura_180
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!factura) {
      console.log('❌ No hay facturas en la BD. Crea una factura primero.');
      process.exit(1);
    }

    console.log(`✅ Factura encontrada: ${factura.numero}`);
    console.log(`   Cliente ID: ${factura.cliente_id}`);
    console.log(`   Total: ${factura.total} €`);
    console.log(`   Empresa ID: ${factura.empresa_id}`);
    console.log(`   ⚠️  Simulando VeriFactu activo en modo TEST (sin modificar BD)`);

    // 2. Obtener emisor
    console.log('\n📋 Obteniendo datos del emisor...');
    const [emisor] = await sql`
      SELECT * FROM emisor_180
      WHERE empresa_id = ${factura.empresa_id}
      LIMIT 1
    `;

    if (!emisor) {
      console.log('❌ No hay emisor configurado para esta empresa.');
      process.exit(1);
    }
    console.log(`✅ Emisor: ${emisor.nombre}`);
    console.log(`   Numeración bloqueada: ${emisor.numeracion_bloqueada ? 'SÍ' : 'NO'}`);
    if (emisor.numeracion_bloqueada) {
      console.log(`   Año bloqueado: ${emisor.anio_numeracion_bloqueada}`);
    }

    // 3. Obtener/simular config con VeriFactu TEST
    console.log('\n📋 Configurando VeriFactu en modo TEST...');
    let [config] = await sql`
      SELECT * FROM configuracionsistema_180
      WHERE empresa_id = ${factura.empresa_id}
      LIMIT 1
    `;

    // Simular VeriFactu activo en modo TEST (sin modificar BD)
    if (!config) {
      config = {
        empresa_id: factura.empresa_id,
        verifactu_activo: true,
        verifactu_modo: 'TEST',
        verifactu_nombre_sistema: 'CONTENDO_GESTIONES',
        verifactu_id_sistema: 'CONT001',
        verifactu_version: '1.0'
      };
    } else {
      // Clonar config y forzar VeriFactu TEST
      config = {
        ...config,
        verifactu_activo: true,
        verifactu_modo: 'TEST'
      };
    }

    console.log(`✅ VeriFactu: ACTIVO (modo ${config.verifactu_modo})`);

    // 4. Obtener cliente
    console.log('\n📋 Obteniendo datos del cliente...');
    const [cliente] = await sql`
      SELECT c.*, f.razon_social, f.nif_cif, f.direccion_fiscal,
             f.municipio, f.codigo_postal, f.provincia as prov_fiscal
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.id = ${factura.cliente_id}
    `;

    if (!cliente) {
      console.log('❌ Cliente no encontrado');
      process.exit(1);
    }
    console.log(`✅ Cliente: ${cliente.razon_social || cliente.nombre}`);

    // 5. Obtener líneas
    console.log('\n📋 Obteniendo líneas de factura...');
    const lineas = await sql`
      SELECT * FROM lineafactura_180
      WHERE factura_id = ${factura.id}
      ORDER BY id ASC
    `;

    if (!lineas?.length) {
      console.log('❌ La factura no tiene líneas');
      process.exit(1);
    }
    console.log(`✅ ${lineas.length} línea(s) encontrada(s)`);

    // 5.5. Generar hash VeriFactu temporal si no existe
    let facturaConHash = { ...factura };

    if (!factura.verifactu_hash) {
      console.log('\n🔐 Generando hash VeriFactu temporal (sin guardar en BD)...');
      // Generar un hash SHA-256 de prueba
      const datosHash = `${factura.numero}|${factura.fecha}|${factura.total}|${emisor.nif || 'B12345678'}`;
      const hash = crypto.createHash('sha256').update(datosHash).digest('hex');
      facturaConHash.verifactu_hash = hash;
      console.log(`✅ Hash generado: ${hash.substring(0, 32)}...`);
    } else {
      console.log(`\n✅ Hash VeriFactu existente: ${factura.verifactu_hash.substring(0, 32)}...`);
    }

    // 6. Generar HTML usando el código REAL
    console.log('\n📝 Generando HTML con código real de facturaPdfService.js...');
    const html = await generarHtmlFactura(facturaConHash, emisor, cliente, lineas, config, {
      incluirMensajeIva: true
    });

    // 7. Guardar en Desktop
    const desktopPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
    const fileName = `FACTURA_REAL_${factura.numero.replace(/\//g, '-')}.html`;
    const filePath = path.join(desktopPath, fileName);

    fs.writeFileSync(filePath, html, 'utf-8');

    console.log('\n✅ HTML generado correctamente!');
    console.log(`📁 Ubicación: ${filePath}`);

    console.log('\n📖 INSTRUCCIONES:');
    console.log('   1. Abre el archivo HTML en tu navegador');
    console.log('   2. Usa Ctrl+P (Windows) o Cmd+P (Mac) para imprimir');
    console.log('   3. Selecciona "Guardar como PDF" como destino');
    console.log('   4. Configura los márgenes en "Ninguno"');
    console.log('   5. Guarda el PDF en tu Desktop');

    console.log('\n🔍 VERIFICAR (VeriFactu TEST activo):');
    console.log('   ✓ QR Code visible ENTRE emisor y cliente (centro superior)');
    console.log('   ✓ Texto "VERI*FACTU" bajo el QR');
    console.log('   ✓ Marca de agua "ENTORNO DE PRUEBAS" en diagonal (modo TEST)');
    console.log('   ✓ Aviso legal VeriFactu (RD 1619/2012) en parte inferior');
    console.log('   ✓ Textos legales completos en pie de página');
    console.log('   ✓ Logo del emisor en esquina superior izquierda');
    console.log('   ✓ Formato A4 correcto (210mm x 297mm)');
    console.log('   ✓ Todos los datos legibles y bien posicionados');
    console.log('\n⚠️ IMPORTANTE - MODO TEST:');
    console.log('   • La numeración NO se bloquea en modo TEST');
    console.log('   • Se usa la serie TEST (TEST-2026-0001, TEST-2026-0002...)');
    console.log('   • NO consume la numeración oficial (F-2026-XXXX)');
    console.log('   • Puedes validar infinitas facturas de prueba');
    console.log('   • Al pasar a PRODUCCION, empezará desde F-2026-0001');
    console.log('   • La numeración se bloqueará irreversiblemente en PRODUCCION');

    console.log('\n🎉 Test completado. Abre el HTML en tu Desktop para validar.\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error en el test:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testFacturaReal();
