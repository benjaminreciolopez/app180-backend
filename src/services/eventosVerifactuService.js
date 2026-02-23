import { sql } from '../db.js';
import crypto from 'crypto';

/**
 * Servicio de Registro de Eventos del Sistema VeriFactu
 *
 * Requisito RD 1007/2023: Los SIF deben disponer de un registro de eventos
 * automatizado que anote paradas, arranques, cambios de modo, etc.
 *
 * Características:
 * - Hash encadenado (como facturas)
 * - Inmutable
 * - Trazabilidad completa
 */

/**
 * Obtiene el hash del último evento de una empresa
 */
async function obtenerHashAnteriorEvento(empresaId) {
  const [ultimo] = await sql`
    SELECT hash_actual FROM eventos_sistema_verifactu_180
    WHERE empresa_id = ${empresaId}
    ORDER BY fecha_evento DESC, id DESC
    LIMIT 1
  `;
  return ultimo ? ultimo.hash_actual : '';
}

/**
 * Genera hash SHA-256 del evento
 */
function generarHashEvento(evento, hashAnterior) {
  const payload = {
    empresa_id: evento.empresa_id,
    tipo_evento: evento.tipo_evento,
    descripcion: evento.descripcion,
    fecha_evento: evento.fecha_evento.toISOString(),
    hash_anterior: hashAnterior || '',
    datos: evento.datos_evento || {}
  };

  // Serialización canónica
  const keys = Object.keys(payload).sort();
  const sortedPayload = {};
  keys.forEach(key => {
    sortedPayload[key] = payload[key];
  });

  const canonico = JSON.stringify(sortedPayload);
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Registra un evento del sistema
 *
 * @param {Object} params
 * @param {number} params.empresaId - ID de la empresa
 * @param {string} params.tipoEvento - Tipo de evento (ver tipos en tabla)
 * @param {string} params.descripcion - Descripción del evento
 * @param {Object} params.datosEvento - Datos adicionales (JSON)
 * @param {number} params.usuarioId - ID del usuario (opcional)
 * @param {string} params.ipAddress - IP del cliente (opcional)
 * @param {string} params.userAgent - User agent (opcional)
 */
export async function registrarEventoSistema({
  empresaId,
  tipoEvento,
  descripcion,
  datosEvento = {},
  usuarioId = null,
  ipAddress = null,
  userAgent = null
}) {
  try {
    const fechaEvento = new Date();
    const hashAnterior = await obtenerHashAnteriorEvento(empresaId);

    const evento = {
      empresa_id: empresaId,
      tipo_evento: tipoEvento,
      descripcion,
      fecha_evento: fechaEvento,
      datos_evento: datosEvento
    };

    const hashActual = generarHashEvento(evento, hashAnterior);

    const [nuevoEvento] = await sql`
      INSERT INTO eventos_sistema_verifactu_180 (
        empresa_id,
        tipo_evento,
        descripcion,
        datos_evento,
        usuario_id,
        fecha_evento,
        hash_actual,
        hash_anterior,
        ip_address,
        user_agent
      ) VALUES (
        ${empresaId},
        ${tipoEvento},
        ${descripcion},
        ${JSON.stringify(datosEvento)},
        ${usuarioId},
        ${fechaEvento},
        ${hashActual},
        ${hashAnterior},
        ${ipAddress},
        ${userAgent}
      )
      RETURNING *
    `;

    console.log(`📝 Evento registrado: ${tipoEvento} (${empresaId}) - Hash: ${hashActual.substring(0, 8)}...`);

    return nuevoEvento;

  } catch (error) {
    console.error('❌ Error al registrar evento VeriFactu:', error);
    throw error;
  }
}

/**
 * Helpers para registrar eventos específicos
 */

export async function registrarInicioSistema(empresaId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'INICIO_SISTEMA',
    descripcion: 'Sistema CONTENDO iniciado',
    datosEvento: {
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      timestamp: new Date().toISOString()
    }
  });
}

export async function registrarParadaSistema(empresaId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'PARADA_SISTEMA',
    descripcion: 'Sistema CONTENDO detenido',
    datosEvento: {
      timestamp: new Date().toISOString()
    }
  });
}

export async function registrarCambioModo(empresaId, modoAnterior, modoNuevo, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'CAMBIO_MODO',
    descripcion: `Modo VeriFactu cambiado de ${modoAnterior} a ${modoNuevo}`,
    datosEvento: {
      modo_anterior: modoAnterior,
      modo_nuevo: modoNuevo,
      irreversible: modoNuevo === 'PRODUCCION'
    },
    usuarioId
  });
}

export async function registrarActivacionVerifactu(empresaId, modo, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'ACTIVACION_VERIFACTU',
    descripcion: `VeriFactu activado en modo ${modo}`,
    datosEvento: {
      modo: modo,
      advertencia: modo === 'PRODUCCION' ? 'Irreversible tras primera factura' : null
    },
    usuarioId
  });
}

export async function registrarDesactivacionVerifactu(empresaId, razon, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'DESACTIVACION_VERIFACTU',
    descripcion: `VeriFactu desactivado: ${razon}`,
    datosEvento: {
      razon: razon
    },
    usuarioId
  });
}

export async function registrarDescargaRegistros(empresaId, tipoDescarga, cantidadRegistros, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'DESCARGA_REGISTROS',
    descripcion: `Descarga de registros VeriFactu (${tipoDescarga})`,
    datosEvento: {
      tipo_descarga: tipoDescarga,
      cantidad_registros: cantidadRegistros,
      formato: 'XML'
    },
    usuarioId
  });
}

export async function registrarRestauracionBackup(empresaId, origenBackup, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'RESTAURACION_BACKUP',
    descripcion: `Restauración desde backup: ${origenBackup}`,
    datosEvento: {
      origen: origenBackup,
      advertencia: 'Operación crítica - Puede afectar integridad'
    },
    usuarioId
  });
}

export async function registrarIncidencia(empresaId, descripcion, detalles, usuarioId = null) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'INCIDENCIA',
    descripcion: `Incidencia: ${descripcion}`,
    datosEvento: {
      detalles: detalles,
      severidad: 'MEDIA'
    },
    usuarioId
  });
}

export async function registrarEnvioAeat(empresaId, cantidadEnviados, cantidadErrores, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'ENVIO_AEAT',
    descripcion: `Envío a AEAT: ${cantidadEnviados} enviados, ${cantidadErrores} errores`,
    datosEvento: {
      enviados: cantidadEnviados,
      errores: cantidadErrores
    },
    usuarioId
  });
}

export async function registrarCambioConfiguracion(empresaId, campoModificado, valorAnterior, valorNuevo, usuarioId) {
  return registrarEventoSistema({
    empresaId,
    tipoEvento: 'CONFIGURACION',
    descripcion: `Configuración modificada: ${campoModificado}`,
    datosEvento: {
      campo: campoModificado,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo
    },
    usuarioId
  });
}

/**
 * Obtiene todos los eventos de una empresa
 */
export async function obtenerEventos(empresaId, { limit = 100, offset = 0, tipoEvento = null } = {}) {
  let query = sql`
    SELECT
      e.*,
      u.nombre as usuario_nombre,
      u.email as usuario_email
    FROM eventos_sistema_verifactu_180 e
    LEFT JOIN users_180 u ON u.id = e.usuario_id
    WHERE e.empresa_id = ${empresaId}
  `;

  if (tipoEvento) {
    query = sql`${query} AND e.tipo_evento = ${tipoEvento}`;
  }

  query = sql`${query}
    ORDER BY e.fecha_evento DESC, e.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return await query;
}

/**
 * Verifica la integridad del encadenamiento de eventos
 */
export async function verificarIntegridadEventos(empresaId) {
  const eventos = await sql`
    SELECT id, tipo_evento, descripcion, fecha_evento, hash_actual, hash_anterior, datos_evento, empresa_id
    FROM eventos_sistema_verifactu_180
    WHERE empresa_id = ${empresaId}
    ORDER BY fecha_evento ASC, id ASC
  `;

  if (eventos.length === 0) {
    return { valido: true, mensaje: 'No hay eventos registrados' };
  }

  let hashAnteriorEsperado = '';
  const errores = [];

  for (let i = 0; i < eventos.length; i++) {
    const evento = eventos[i];

    // Verificar hash anterior
    if (evento.hash_anterior !== hashAnteriorEsperado) {
      errores.push({
        evento_id: evento.id,
        error: 'Hash anterior no coincide',
        esperado: hashAnteriorEsperado,
        obtenido: evento.hash_anterior
      });
    }

    // Recalcular hash actual
    const hashCalculado = generarHashEvento({
      empresa_id: evento.empresa_id,
      tipo_evento: evento.tipo_evento,
      descripcion: evento.descripcion,
      fecha_evento: new Date(evento.fecha_evento),
      datos_evento: evento.datos_evento
    }, evento.hash_anterior);

    if (hashCalculado !== evento.hash_actual) {
      errores.push({
        evento_id: evento.id,
        error: 'Hash actual no coincide',
        esperado: hashCalculado,
        obtenido: evento.hash_actual
      });
    }

    hashAnteriorEsperado = evento.hash_actual;
  }

  return {
    valido: errores.length === 0,
    total_eventos: eventos.length,
    errores: errores,
    mensaje: errores.length === 0
      ? 'Cadena de eventos íntegra y válida'
      : `${errores.length} error(es) detectado(s)`
  };
}

/**
 * Obtiene estadísticas de eventos
 */
export async function obtenerEstadisticasEventos(empresaId) {
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_eventos,
      COUNT(DISTINCT tipo_evento) as tipos_diferentes,
      MIN(fecha_evento) as primer_evento,
      MAX(fecha_evento) as ultimo_evento,
      jsonb_object_agg(tipo_evento, count) as por_tipo
    FROM (
      SELECT
        tipo_evento,
        fecha_evento,
        COUNT(*) as count
      FROM eventos_sistema_verifactu_180
      WHERE empresa_id = ${empresaId}
      GROUP BY tipo_evento, fecha_evento
    ) sub
  `;

  return stats;
}
