import { sql } from '../db.js';
import { validarCertificado } from './firmaDigitalService.js';

/**
 * Servicio de Renovación de Certificados Digitales
 *
 * Detecta certificados próximos a caducar y notifica al usuario
 * con links directos a renovación FNMT
 */

/**
 * Calcula días hasta que caduque el certificado
 */
function diasHastaCaducidad(fechaCaducidad) {
  const ahora = new Date();
  const caducidad = new Date(fechaCaducidad);
  const diffTime = caducidad - ahora;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Determina el nivel de urgencia de renovación
 */
function obtenerNivelUrgencia(diasRestantes) {
  if (diasRestantes < 0) {
    return {
      nivel: 'CRITICO',
      mensaje: '🚨 CERTIFICADO CADUCADO',
      color: 'red',
      prioridad: 1
    };
  } else if (diasRestantes <= 7) {
    return {
      nivel: 'MUY_URGENTE',
      mensaje: '⚠️ Caduca en menos de 1 semana',
      color: 'red',
      prioridad: 2
    };
  } else if (diasRestantes <= 15) {
    return {
      nivel: 'URGENTE',
      mensaje: '⚠️ Caduca en menos de 15 días',
      color: 'orange',
      prioridad: 3
    };
  } else if (diasRestantes <= 30) {
    return {
      nivel: 'IMPORTANTE',
      mensaje: '⚠️ Caduca en menos de 1 mes',
      color: 'orange',
      prioridad: 4
    };
  } else if (diasRestantes <= 60) {
    return {
      nivel: 'AVISO',
      mensaje: 'ℹ️ Ya puedes renovar tu certificado',
      color: 'blue',
      prioridad: 5
    };
  }
  return null; // No requiere acción
}

/**
 * Genera link directo para renovación según tipo de certificado
 */
function generarLinkRenovacion(tipoCertificado = 'FNMT') {
  const links = {
    FNMT: {
      url: 'https://www.cert.fnmt.es/certificados/persona-fisica/renovar-certificado',
      nombre: 'Renovación FNMT',
      descripcion: 'Renovar certificado de Persona Física'
    },
    AEAT: {
      url: 'https://sede.agenciatributaria.gob.es/Sede/procedimientos-ayuda/DF51.shtml',
      nombre: 'Renovación AEAT',
      descripcion: 'Gestión de certificados AEAT'
    },
    FNMT_JURIDICA: {
      url: 'https://www.cert.fnmt.es/certificados/persona-juridica/renovar-certificado',
      nombre: 'Renovación FNMT Jurídica',
      descripcion: 'Renovar certificado de Persona Jurídica'
    }
  };

  return links[tipoCertificado] || links.FNMT;
}

/**
 * Detecta el tipo de certificado basándose en el emisor
 */
function detectarTipoCertificado(certificadoInfo) {
  const emisor = certificadoInfo?.issuer?.O || '';
  const cn = certificadoInfo?.subject?.CN || '';

  if (emisor.includes('FNMT')) {
    // Verificar si es persona física o jurídica
    if (cn.includes('NOMBRE') || cn.includes('APELLIDOS')) {
      return 'FNMT';
    }
    return 'FNMT_JURIDICA';
  }

  if (emisor.includes('AEAT') || emisor.includes('Agencia Tributaria')) {
    return 'AEAT';
  }

  // Por defecto asumir FNMT persona física
  return 'FNMT';
}

/**
 * Verifica estado de certificados de una empresa
 */
export async function verificarEstadoCertificados(empresaId) {
  try {
    // Obtener configuración con certificados
    const [config] = await sql`
      SELECT
        verifactu_certificado_path,
        verifactu_certificado_password,
        verifactu_cert_fabricante_path,
        verifactu_cert_fabricante_password,
        verifactu_info_fabricante
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
    `;

    if (!config) {
      return { necesitaRenovacion: false, mensaje: 'No hay certificados configurados' };
    }

    const resultados = {
      cliente: null,
      fabricante: null,
      necesitaRenovacion: false,
      certificadosCriticos: []
    };

    // Verificar certificado del cliente
    if (config.verifactu_certificado_path) {
      try {
        const validacion = await validarCertificado(
          config.verifactu_certificado_path,
          config.verifactu_certificado_password
        );

        if (validacion.info) {
          const diasRestantes = diasHastaCaducidad(validacion.info.validTo);
          const urgencia = obtenerNivelUrgencia(diasRestantes);
          const tipo = detectarTipoCertificado(validacion.info);
          const linkRenovacion = generarLinkRenovacion(tipo);

          resultados.cliente = {
            valido: validacion.valido,
            diasRestantes,
            fechaCaducidad: validacion.info.validTo,
            urgencia,
            tipoCertificado: tipo,
            linkRenovacion,
            info: validacion.info
          };

          if (urgencia) {
            resultados.necesitaRenovacion = true;
            resultados.certificadosCriticos.push({
              tipo: 'cliente',
              ...resultados.cliente
            });
          }
        }
      } catch (error) {
        console.error('Error al verificar certificado cliente:', error);
      }
    }

    // Verificar certificado del fabricante (si es diferente)
    if (config.verifactu_cert_fabricante_path &&
        config.verifactu_cert_fabricante_path !== config.verifactu_certificado_path) {
      try {
        const validacion = await validarCertificado(
          config.verifactu_cert_fabricante_path,
          config.verifactu_cert_fabricante_password
        );

        if (validacion.info) {
          const diasRestantes = diasHastaCaducidad(validacion.info.validTo);
          const urgencia = obtenerNivelUrgencia(diasRestantes);
          const tipo = detectarTipoCertificado(validacion.info);
          const linkRenovacion = generarLinkRenovacion(tipo);

          resultados.fabricante = {
            valido: validacion.valido,
            diasRestantes,
            fechaCaducidad: validacion.info.validTo,
            urgencia,
            tipoCertificado: tipo,
            linkRenovacion,
            info: validacion.info
          };

          if (urgencia) {
            resultados.necesitaRenovacion = true;
            resultados.certificadosCriticos.push({
              tipo: 'fabricante',
              ...resultados.fabricante
            });
          }
        }
      } catch (error) {
        console.error('Error al verificar certificado fabricante:', error);
      }
    }

    return resultados;

  } catch (error) {
    console.error('❌ Error al verificar estado de certificados:', error);
    throw error;
  }
}

/**
 * Crea notificación de renovación de certificado
 */
export async function crearNotificacionRenovacion(empresaId, certificadoInfo) {
  try {
    const { tipo, diasRestantes, urgencia, linkRenovacion } = certificadoInfo;

    let titulo, mensaje;

    if (diasRestantes < 0) {
      titulo = `🚨 Certificado ${tipo} CADUCADO`;
      mensaje = `Tu certificado digital ha caducado. Renuévalo inmediatamente para seguir usando VeriFactu.`;
    } else if (diasRestantes <= 7) {
      titulo = `⚠️ Certificado ${tipo} caduca en ${diasRestantes} días`;
      mensaje = `Tu certificado digital caduca muy pronto. Renuévalo AHORA para evitar interrupciones.`;
    } else if (diasRestantes <= 30) {
      titulo = `⚠️ Certificado ${tipo} caduca pronto`;
      mensaje = `Tu certificado digital caduca en ${diasRestantes} días. Renuévalo cuanto antes.`;
    } else {
      titulo = `ℹ️ Puedes renovar tu certificado ${tipo}`;
      mensaje = `Tu certificado digital caduca en ${diasRestantes} días. Ya puedes renovarlo online.`;
    }

    // Crear notificación en la BD
    await sql`
      INSERT INTO notificaciones_180 (
        empresa_id,
        tipo,
        titulo,
        mensaje,
        prioridad,
        datos_adicionales,
        leida,
        fecha_creacion
      ) VALUES (
        ${empresaId},
        'RENOVACION_CERTIFICADO',
        ${titulo},
        ${mensaje},
        ${urgencia.prioridad},
        ${JSON.stringify({
          diasRestantes,
          urgencia: urgencia.nivel,
          linkRenovacion,
          tipoCertificado: tipo
        })},
        false,
        NOW()
      )
    `;

    console.log(`✅ Notificación de renovación creada para empresa ${empresaId}`);

  } catch (error) {
    console.error('❌ Error al crear notificación:', error);
  }
}

/**
 * Verifica todos los certificados de todas las empresas (para cron job)
 */
export async function verificarTodosCertificados() {
  try {
    console.log('🔍 Verificando certificados de todas las empresas...');

    // Obtener todas las empresas con VeriFactu activo
    const empresas = await sql`
      SELECT DISTINCT e.id, e.nombre
      FROM empresa_180 e
      INNER JOIN configuracionsistema_180 c ON c.empresa_id = e.id
      WHERE c.verifactu_activo = true
        AND (c.verifactu_certificado_path IS NOT NULL
             OR c.verifactu_cert_fabricante_path IS NOT NULL)
    `;

    let totalVerificados = 0;
    let totalNotificaciones = 0;

    for (const empresa of empresas) {
      try {
        const estado = await verificarEstadoCertificados(empresa.id);

        if (estado.necesitaRenovacion) {
          for (const cert of estado.certificadosCriticos) {
            await crearNotificacionRenovacion(empresa.id, cert);
            totalNotificaciones++;
          }
        }

        totalVerificados++;
      } catch (error) {
        console.error(`Error verificando empresa ${empresa.id}:`, error);
      }
    }

    console.log(`✅ Verificación completa: ${totalVerificados} empresas, ${totalNotificaciones} notificaciones`);

    return {
      totalVerificados,
      totalNotificaciones
    };

  } catch (error) {
    console.error('❌ Error en verificación masiva de certificados:', error);
    throw error;
  }
}

/**
 * Genera instrucciones de renovación paso a paso
 */
export function generarInstruccionesRenovacion(tipoCertificado, diasRestantes) {
  const baseInstrucciones = {
    FNMT: [
      '1. Accede a www.cert.fnmt.es con tu certificado actual',
      '2. Ve a la sección "Renovación de certificado"',
      '3. Sigue los pasos en pantalla (es automático)',
      '4. Descarga el nuevo certificado .p12',
      '5. Actualiza en CONTENDO usando el endpoint /certificado/configurar-auto'
    ],
    AEAT: [
      '1. Accede a sede.agenciatributaria.gob.es',
      '2. Identificate con tu certificado actual',
      '3. Ve a "Certificados electrónicos"',
      '4. Solicita renovación',
      '5. Descarga el nuevo certificado',
      '6. Actualiza en CONTENDO'
    ]
  };

  const urgencia = diasRestantes < 0
    ? '⚠️ URGENTE: Tu certificado ha caducado. Renuévalo INMEDIATAMENTE.'
    : diasRestantes <= 7
    ? '⚠️ URGENTE: Te quedan solo ' + diasRestantes + ' días.'
    : diasRestantes <= 30
    ? 'ℹ️ Te quedan ' + diasRestantes + ' días para renovar.'
    : 'ℹ️ Ya puedes renovar tu certificado online.';

  return {
    urgencia,
    pasos: baseInstrucciones[tipoCertificado] || baseInstrucciones.FNMT,
    estimacionTiempo: '10-15 minutos',
    requierePresencial: false
  };
}
