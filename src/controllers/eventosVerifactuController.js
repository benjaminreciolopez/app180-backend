import { sql } from '../db.js';
import {
  obtenerEventos,
  verificarIntegridadEventos,
  obtenerEstadisticasEventos
} from '../services/eventosVerifactuService.js';

/**
 * Obtiene el ID de empresa del usuario
 */
async function getEmpresaId(userIdOrReq) {
  if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
    if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
    userIdOrReq = userIdOrReq.user.id;
  }
  const [empresa] = await sql`
    SELECT id FROM empresa_180
    WHERE user_id = ${userIdOrReq}
    LIMIT 1
  `;
  if (!empresa) {
    const error = new Error('Empresa no encontrada');
    error.status = 403;
    throw error;
  }
  return empresa.id;
}

/**
 * Lista eventos del sistema VeriFactu
 * GET /admin/verifactu/eventos
 */
export async function listarEventos(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { tipo, limit = 100, offset = 0 } = req.query;

    const eventos = await obtenerEventos(empresaId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      tipoEvento: tipo || null
    });

    // Contar total
    const [count] = await sql`
      SELECT COUNT(*) as total
      FROM eventos_sistema_verifactu_180
      WHERE empresa_id = ${empresaId}
      ${tipo ? sql`AND tipo_evento = ${tipo}` : sql``}
    `;

    res.json({
      eventos,
      total: parseInt(count.total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error en listarEventos:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Obtiene estadísticas de eventos
 * GET /admin/verifactu/eventos/stats
 */
export async function obtenerEstadisticas(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const stats = await obtenerEstadisticasEventos(empresaId);

    res.json(stats);

  } catch (error) {
    console.error('Error en obtenerEstadisticas:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Verifica la integridad de la cadena de eventos
 * GET /admin/verifactu/eventos/verificar
 */
export async function verificarIntegridad(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const resultado = await verificarIntegridadEventos(empresaId);

    const statusCode = resultado.valido ? 200 : 500;

    res.status(statusCode).json(resultado);

  } catch (error) {
    console.error('Error en verificarIntegridad:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Obtiene tipos de eventos disponibles
 * GET /admin/verifactu/eventos/tipos
 */
export async function obtenerTiposEventos(req, res) {
  try {
    const tipos = [
      { value: 'INICIO_SISTEMA', label: 'Inicio del sistema' },
      { value: 'PARADA_SISTEMA', label: 'Parada del sistema' },
      { value: 'CAMBIO_MODO', label: 'Cambio de modo (TEST/PRODUCCION)' },
      { value: 'ACTIVACION_VERIFACTU', label: 'Activación de VeriFactu' },
      { value: 'DESACTIVACION_VERIFACTU', label: 'Desactivación de VeriFactu' },
      { value: 'DESCARGA_REGISTROS', label: 'Descarga de registros' },
      { value: 'RESTAURACION_BACKUP', label: 'Restauración desde backup' },
      { value: 'INCIDENCIA', label: 'Incidencia del sistema' },
      { value: 'ENVIO_AEAT', label: 'Envío de registros a AEAT' },
      { value: 'CONFIGURACION', label: 'Cambio de configuración' },
      { value: 'MANTENIMIENTO', label: 'Operación de mantenimiento' }
    ];

    res.json({ tipos });

  } catch (error) {
    console.error('Error en obtenerTiposEventos:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}
