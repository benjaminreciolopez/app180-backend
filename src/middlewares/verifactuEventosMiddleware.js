import { sql } from '../db.js';
import {
  registrarCambioModo,
  registrarActivacion,
  registrarDesactivacion
} from '../services/eventosVerifactuService.js';

/**
 * Middleware para logging automático de eventos VeriFactu
 *
 * Se ejecuta DESPUÉS de modificar configuración VeriFactu
 * para registrar automáticamente los cambios en la tabla de eventos
 */
export async function logCambiosVerifactu(req, res, next) {
  // Guardar la función original res.json
  const originalJson = res.json.bind(res);

  // Interceptar la respuesta
  res.json = async function(data) {
    try {
      // Si es una actualización de configuración VeriFactu
      if (req.method === 'PUT' && req.body && req.empresaId) {
        const { verifactu_activo, verifactu_modo } = req.body;

        // Obtener configuración anterior
        const [configAnterior] = await sql`
          SELECT verifactu_activo, verifactu_modo
          FROM configuracionsistema_180
          WHERE empresa_id = ${req.empresaId}
        `;

        if (configAnterior) {
          const cambioActivo = verifactu_activo !== undefined &&
            verifactu_activo !== configAnterior.verifactu_activo;

          const cambioModo = verifactu_modo !== undefined &&
            verifactu_modo !== configAnterior.verifactu_modo;

          // Registrar eventos automáticamente
          if (cambioActivo) {
            if (verifactu_activo === true) {
              await registrarActivacion(req.empresaId, verifactu_modo || 'TEST', req.userId);
            } else {
              await registrarDesactivacion(req.empresaId, req.userId);
            }
          } else if (cambioModo) {
            await registrarCambioModo(
              req.empresaId,
              configAnterior.verifactu_modo,
              verifactu_modo,
              req.userId
            );
          }
        }
      }
    } catch (error) {
      // No fallar la petición si el logging falla
      console.error('⚠️ Error al registrar evento VeriFactu:', error);
    }

    // Llamar a la función original
    return originalJson(data);
  };

  next();
}

/**
 * Middleware para logging de envíos AEAT
 *
 * Se ejecuta DESPUÉS de enviar registros a AEAT
 */
export async function logEnviosAeat(req, res, next) {
  // Guardar la función original res.json
  const originalJson = res.json.bind(res);

  // Interceptar la respuesta
  res.json = async function(data) {
    try {
      // Si es un envío exitoso
      if (data && data.success && data.enviados !== undefined) {
        const { registrarEnvioAeat } = await import('../services/eventosVerifactuService.js');

        await registrarEnvioAeat(
          req.empresaId,
          data.enviados || 0,
          data.errores || 0,
          req.userId
        );
      }
    } catch (error) {
      console.error('⚠️ Error al registrar evento de envío AEAT:', error);
    }

    return originalJson(data);
  };

  next();
}
