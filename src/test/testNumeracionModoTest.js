import { sql } from '../db.js';

/**
 * Script para verificar que en modo TEST la numeración NO se incrementa
 */

async function testNumeracionModoTest() {
  try {
    console.log('\n🔢 TEST DE NUMERACIÓN EN MODO TEST\n');

    // 1. Buscar una empresa con VeriFactu en modo TEST
    console.log('📋 Buscando empresa con VeriFactu en modo TEST...');

    const [empresa] = await sql`
      SELECT e.*, c.verifactu_activo, c.verifactu_modo
      FROM empresa_180 e
      INNER JOIN configuracionsistema_180 c ON c.empresa_id = e.id
      WHERE c.verifactu_activo = true
        AND c.verifactu_modo = 'TEST'
      LIMIT 1
    `;

    if (!empresa) {
      console.log('⚠️ No hay empresas con VeriFactu en modo TEST');
      console.log('   Crea una empresa de prueba primero o activa VeriFactu en modo TEST');
      process.exit(1);
    }

    console.log(`✅ Empresa encontrada: ${empresa.id}`);
    console.log(`   VeriFactu: ${empresa.verifactu_modo}`);

    // 2. Verificar numeración actual del emisor
    const [emisorAntes] = await sql`
      SELECT siguiente_numero, numeracion_bloqueada, anio_numeracion_bloqueada
      FROM emisor_180
      WHERE empresa_id = ${empresa.id}
      LIMIT 1
    `;

    console.log('\n📊 Estado ANTES de validar factura:');
    console.log(`   Siguiente número: ${emisorAntes?.siguiente_numero || 'No configurado'}`);
    console.log(`   Numeración bloqueada: ${emisorAntes?.numeracion_bloqueada ? 'SÍ' : 'NO'}`);
    if (emisorAntes?.numeracion_bloqueada) {
      console.log(`   Año bloqueado: ${emisorAntes.anio_numeracion_bloqueada}`);
    }

    // 3. Buscar última factura validada
    const [ultimaFactura] = await sql`
      SELECT numero, fecha, estado
      FROM factura_180
      WHERE empresa_id = ${empresa.id}
        AND estado = 'VALIDADA'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log('\n📄 Última factura validada:');
    if (ultimaFactura) {
      console.log(`   Número: ${ultimaFactura.numero}`);
      console.log(`   Fecha: ${new Date(ultimaFactura.fecha).toLocaleDateString('es-ES')}`);
    } else {
      console.log('   No hay facturas validadas');
    }

    // 4. Contar facturas en borrador
    const [countBorrador] = await sql`
      SELECT COUNT(*) as total
      FROM factura_180
      WHERE empresa_id = ${empresa.id}
        AND estado = 'BORRADOR'
    `;

    console.log(`\n📝 Facturas en borrador: ${countBorrador.total}`);

    if (countBorrador.total === 0) {
      console.log('\n⚠️ No hay facturas en borrador para validar');
      console.log('   Crea una factura de prueba primero');
      process.exit(1);
    }

    // 5. Obtener una factura en borrador
    const [facturaBorrador] = await sql`
      SELECT id, numero, estado
      FROM factura_180
      WHERE empresa_id = ${empresa.id}
        AND estado = 'BORRADOR'
      LIMIT 1
    `;

    console.log(`\n🔄 Factura a validar (ID: ${facturaBorrador.id})`);
    console.log(`   Estado actual: ${facturaBorrador.estado}`);

    // 6. Simular validación (SIN EJECUTAR)
    console.log('\n⚠️ ADVERTENCIA:');
    console.log('   Este script NO validará la factura para evitar modificar la BD');
    console.log('   Para probar completamente, ejecuta la validación manualmente y verifica:');
    console.log('   1. ¿Se genera el número siguiente?');
    console.log('   2. ¿Se incrementa el correlativo en emisor_180?');
    console.log('   3. ¿Se bloquea la numeración?');

    // 7. Mostrar código actual de generación de número
    console.log('\n📖 ANÁLISIS DEL CÓDIGO:');
    console.log('   El código en facturasController.js (línea 630):');
    console.log('   > const numero = await generarNumeroFactura(empresaId, fecha);');
    console.log('');
    console.log('   La función generarNumeroFactura() NO verifica el modo VeriFactu');
    console.log('   Siempre incrementa el correlativo, incluso en modo TEST');
    console.log('');
    console.log('   ❌ PROBLEMA DETECTADO:');
    console.log('   • En modo TEST, la numeración SÍ se incrementa');
    console.log('   • Esto afecta la numeración oficial cuando pases a PRODUCCION');
    console.log('   • Si validas 10 facturas TEST, tu primera factura PROD será la #11');

    console.log('\n💡 SOLUCIÓN RECOMENDADA:');
    console.log('   Opción 1: Usar serie diferente en TEST (F-TEST-0001)');
    console.log('   Opción 2: NO incrementar el correlativo en modo TEST');
    console.log('   Opción 3: Tener un correlativo separado para TEST y PRODUCCION');

    console.log('\n🎯 ¿Quieres que implemente la solución?\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error en el test:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testNumeracionModoTest();
