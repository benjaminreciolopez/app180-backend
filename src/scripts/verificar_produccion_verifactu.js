#!/usr/bin/env node

/**
 * Script de verificación: ¿Tengo clientes con VeriFactu en PRODUCCIÓN?
 *
 * Uso: node src/scripts/verificar_produccion_verifactu.js
 */

import { sql } from '../db.js';

async function verificarEstadoProduccion() {
  console.log('🔍 Verificando estado VeriFactu en todas las empresas...\n');

  try {
    // Obtener todas las empresas con VeriFactu activo
    const empresas = await sql`
      SELECT
        e.id,
        e.nombre as empresa_nombre,
        e.tipo_contribuyente,
        c.verifactu_activo,
        c.verifactu_modo,
        c.verifactu_certificado_path,
        COUNT(r.id) FILTER (WHERE r.estado_envio = 'ENVIADO') as facturas_enviadas,
        COUNT(r.id) FILTER (WHERE r.estado_envio = 'PENDIENTE') as facturas_pendientes,
        COUNT(r.id) FILTER (WHERE r.estado_envio = 'ERROR') as facturas_error,
        COUNT(r.id) as total_registros,
        MIN(r.fecha_envio) FILTER (WHERE r.estado_envio = 'ENVIADO') as primera_factura_enviada
      FROM empresa_180 e
      LEFT JOIN configuracionsistema_180 c ON c.empresa_id = e.id
      LEFT JOIN registroverifactu_180 r ON r.empresa_id = e.id
      WHERE c.verifactu_activo = true
      GROUP BY e.id, e.nombre, e.tipo_contribuyente, c.verifactu_activo, c.verifactu_modo, c.verifactu_certificado_path
      ORDER BY c.verifactu_modo DESC, facturas_enviadas DESC
    `;

    if (empresas.length === 0) {
      console.log('✅ No hay empresas con VeriFactu activo.');
      console.log('   Puedes seguir trabajando sin presión hasta las fechas límite.\n');
      return { produccion: 0, test: 0, total: 0 };
    }

    let produccionCount = 0;
    let testCount = 0;
    let alertas = [];

    console.log(`📊 Encontradas ${empresas.length} empresa(s) con VeriFactu activo:\n`);

    for (const empresa of empresas) {
      const esProduccion = empresa.verifactu_modo === 'PRODUCCION';
      const tieneEnviadas = parseInt(empresa.facturas_enviadas) > 0;
      const tieneCertificado = !!empresa.verifactu_certificado_path;

      if (esProduccion) {
        produccionCount++;
      } else {
        testCount++;
      }

      // Mostrar información de cada empresa
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🏢 Empresa: ${empresa.empresa_nombre} (ID: ${empresa.id})`);
      console.log(`   Tipo: ${empresa.tipo_contribuyente || 'No especificado'}`);
      console.log(`   Modo VeriFactu: ${empresa.verifactu_modo} ${esProduccion ? '🔴' : '🟢'}`);
      console.log(`   Certificado digital: ${tieneCertificado ? '✅ Configurado' : '⚠️ NO configurado'}`);
      console.log(`   Registros totales: ${empresa.total_registros}`);
      console.log(`   • Enviadas: ${empresa.facturas_enviadas}`);
      console.log(`   • Pendientes: ${empresa.facturas_pendientes}`);
      console.log(`   • Errores: ${empresa.facturas_error}`);

      if (tieneEnviadas) {
        console.log(`   Primera factura enviada: ${new Date(empresa.primera_factura_enviada).toLocaleString('es-ES')}`);
      }

      // Análisis de situación
      if (esProduccion && tieneEnviadas) {
        console.log(`\n   ⚠️  SITUACIÓN CRÍTICA:`);
        console.log(`   • Esta empresa YA tiene facturas enviadas a AEAT en PRODUCCIÓN`);
        console.log(`   • VeriFactu está BLOQUEADO (irreversible)`);
        console.log(`   • DEBES cumplir con obligaciones de fabricante AHORA`);

        alertas.push({
          empresa: empresa.empresa_nombre,
          tipo: 'CRITICO',
          mensaje: 'Facturas en producción - Obligaciones inmediatas'
        });

        if (!tieneCertificado) {
          console.log(`   • 🚨 URGENTE: Falta certificado digital para envíos futuros`);
          alertas.push({
            empresa: empresa.empresa_nombre,
            tipo: 'URGENTE',
            mensaje: 'Sin certificado digital configurado'
          });
        }

      } else if (esProduccion && !tieneEnviadas) {
        console.log(`\n   ⚠️  PRECAUCIÓN:`);
        console.log(`   • Modo PRODUCCIÓN activo pero sin facturas enviadas aún`);
        console.log(`   • Cuando envíe la primera factura, será IRREVERSIBLE`);
        console.log(`   • Asegúrate de cumplir requisitos ANTES del primer envío`);

        alertas.push({
          empresa: empresa.empresa_nombre,
          tipo: 'ADVERTENCIA',
          mensaje: 'En producción pero sin facturas enviadas aún'
        });

      } else {
        console.log(`\n   ✅ MODO TEST - Sin presión`);
        console.log(`   • Puedes seguir probando sin compromisos legales`);
        console.log(`   • Los registros no afectan a producción`);
      }

      console.log('');
    }

    // Resumen final
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`📈 RESUMEN:`);
    console.log(`   Total empresas con VeriFactu: ${empresas.length}`);
    console.log(`   • En PRODUCCIÓN: ${produccionCount} ${produccionCount > 0 ? '🔴' : '🟢'}`);
    console.log(`   • En TEST: ${testCount} 🟢\n`);

    // Alertas críticas
    if (alertas.length > 0) {
      console.log(`🚨 ALERTAS (${alertas.length}):\n`);

      const criticas = alertas.filter(a => a.tipo === 'CRITICO');
      const urgentes = alertas.filter(a => a.tipo === 'URGENTE');
      const advertencias = alertas.filter(a => a.tipo === 'ADVERTENCIA');

      if (criticas.length > 0) {
        console.log(`   🔴 CRÍTICAS (${criticas.length}):`);
        criticas.forEach(a => {
          console.log(`      • ${a.empresa}: ${a.mensaje}`);
        });
        console.log('');
      }

      if (urgentes.length > 0) {
        console.log(`   🟠 URGENTES (${urgentes.length}):`);
        urgentes.forEach(a => {
          console.log(`      • ${a.empresa}: ${a.mensaje}`);
        });
        console.log('');
      }

      if (advertencias.length > 0) {
        console.log(`   🟡 ADVERTENCIAS (${advertencias.length}):`);
        advertencias.forEach(a => {
          console.log(`      • ${a.empresa}: ${a.mensaje}`);
        });
        console.log('');
      }
    }

    // Recomendaciones
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`💡 RECOMENDACIONES:\n`);

    if (produccionCount > 0) {
      const tieneEnviadasProduccion = empresas.some(e =>
        e.verifactu_modo === 'PRODUCCION' && parseInt(e.facturas_enviadas) > 0
      );

      if (tieneEnviadasProduccion) {
        console.log(`   🚨 ACCIÓN INMEDIATA REQUERIDA:`);
        console.log(`   1. Registrar software en AEAT (sede electrónica)`);
        console.log(`   2. Firmar declaración responsable como fabricante`);
        console.log(`   3. Verificar cumplimiento técnico al 100%`);
        console.log(`   4. Configurar certificados digitales faltantes`);
        console.log(`   5. Implementar monitoreo de envíos AEAT`);
        console.log(`\n   📖 Ver: backend/docs/VERIFACTU_OBLIGACIONES_FABRICANTE.md`);
      } else {
        console.log(`   ⚠️  Empresas en PRODUCCIÓN pero sin envíos aún:`);
        console.log(`   1. Completar datos de emisor antes de enviar`);
        console.log(`   2. Configurar certificado digital`);
        console.log(`   3. Verificar que TODO esté correcto`);
        console.log(`   4. Una vez enviada la primera factura, es IRREVERSIBLE`);
      }
    } else {
      console.log(`   ✅ Todo en TEST - Sin presión`);
      console.log(`   • Sigue probando tranquilamente`);
      console.log(`   • Prepara todo para antes de fechas límite 2027`);
      console.log(`   • No actives PRODUCCIÓN hasta estar 100% seguro`);
    }

    console.log('');

    return {
      produccion: produccionCount,
      test: testCount,
      total: empresas.length,
      alertas
    };

  } catch (error) {
    console.error('❌ Error al verificar estado:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

// Ejecutar
verificarEstadoProduccion()
  .then(resultado => {
    if (resultado.produccion > 0) {
      console.log('⚠️  Tienes empresas en PRODUCCIÓN - Revisa tus obligaciones');
      process.exit(1); // Exit code 1 indica advertencia
    } else {
      console.log('✅ Todo bien - Puedes seguir trabajando sin presión');
      process.exit(0);
    }
  })
  .catch(error => {
    console.error('Error fatal:', error);
    process.exit(2);
  });
