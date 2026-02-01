// backend/src/middlewares/auditMiddleware.js
import { sql } from '../db.js';
import { getClientIp } from '../utils/clientIp.js';

/**
 * Registra una acción en el log de auditoría
 * @param {Object} params - Parámetros de auditoría
 * @param {string} params.empresaId - ID de la empresa
 * @param {string} params.userId - ID del usuario que ejecuta la acción
 * @param {string} [params.empleadoId] - ID del empleado afectado (opcional)
 * @param {string} params.accion - Tipo de acción realizada
 * @param {string} params.entidadTipo - Tipo de entidad afectada
 * @param {string} params.entidadId - ID de la entidad afectada
 * @param {Object} [params.datosAnteriores] - Estado anterior de la entidad
 * @param {Object} [params.datosNuevos] - Estado nuevo de la entidad
 * @param {string} [params.motivo] - Motivo de la acción
 * @param {Object} [params.req] - Request object para obtener IP y user agent
 */
export async function registrarAuditoria({
  empresaId,
  userId,
  empleadoId = null,
  accion,
  entidadTipo,
  entidadId,
  datosAnteriores = null,
  datosNuevos = null,
  motivo = null,
  req = null
}) {
  try {
    const ipAddress = req ? getClientIp(req) : null;
    const userAgent = req ? req.headers['user-agent'] : null;

    await sql`
      INSERT INTO audit_log_180 (
        empresa_id, user_id, empleado_id,
        accion, entidad_tipo, entidad_id,
        datos_anteriores, datos_nuevos, motivo,
        ip_address, user_agent
      ) VALUES (
        ${empresaId}, ${userId}, ${empleadoId},
        ${accion}, ${entidadTipo}, ${entidadId},
        ${datosAnteriores ? JSON.stringify(datosAnteriores) : null},
        ${datosNuevos ? JSON.stringify(datosNuevos) : null},
        ${motivo},
        ${ipAddress}, ${userAgent}
      )
    `;

    console.log(`✅ Auditoría registrada: ${accion} en ${entidadTipo}:${entidadId}`);
  } catch (error) {
    console.error('❌ Error registrando auditoría:', error);
    // No lanzar error para no bloquear la operación principal
  }
}
