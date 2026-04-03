import { sql } from '../db.js';
import {
  enviarRegistroAeat,
  enviarRegistrosPendientes,
  testConexionAeat
} from '../services/verifactuAeatService.js';
import { obtenerEstadoCumplimiento } from '../middlewares/verifactuComplianceMiddleware.js';

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
 * Lista todos los registros VeriFactu de la empresa
 * GET /admin/verifactu/registros
 */
export async function listarRegistros(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { estado, limit = 100, offset = 0 } = req.query;

    let query = sql`
      SELECT
        r.*,
        f.numero as numero_factura,
        f.fecha as fecha_factura,
        f.total as total_factura,
        c.nombre as cliente_nombre
      FROM registroverifactu_180 r
      LEFT JOIN factura_180 f ON f.id = r.factura_id
      LEFT JOIN clientes_180 c ON c.id = f.cliente_id
      WHERE r.empresa_id = ${empresaId}
    `;

    // Filtro por estado
    if (estado) {
      query = sql`${query} AND r.estado_envio = ${estado}`;
    }

    query = sql`${query}
      ORDER BY r.fecha_registro DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const registros = await query;

    // Contar total
    const [count] = await sql`
      SELECT COUNT(*) as total
      FROM registroverifactu_180
      WHERE empresa_id = ${empresaId}
      ${estado ? sql`AND estado_envio = ${estado}` : sql``}
    `;

    res.json({
      registros,
      total: parseInt(count.total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error en listarRegistros:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Obtiene estadísticas de envíos VeriFactu
 * GET /admin/verifactu/stats
 */
export async function obtenerEstadisticas(req, res) {
  try {
    const empresaId = await getEmpresaId(req);

    const [stats] = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN estado_envio = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
        SUM(CASE WHEN estado_envio = 'ENVIADO' THEN 1 ELSE 0 END) as enviados,
        SUM(CASE WHEN estado_envio = 'ERROR' THEN 1 ELSE 0 END) as errores
      FROM registroverifactu_180
      WHERE empresa_id = ${empresaId}
    `;

    res.json({
      total: parseInt(stats.total),
      pendientes: parseInt(stats.pendientes),
      enviados: parseInt(stats.enviados),
      errores: parseInt(stats.errores)
    });

  } catch (error) {
    console.error('Error en obtenerEstadisticas:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Envía un registro específico a la AEAT
 * POST /admin/verifactu/enviar/:registroId
 */
export async function enviarRegistro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { registroId } = req.params;
    const { entorno = 'PRUEBAS' } = req.body;

    // Verificar que el registro pertenece a la empresa
    const [registro] = await sql`
      SELECT * FROM registroverifactu_180
      WHERE id = ${registroId}
        AND empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!registro) {
      return res.status(404).json({
        error: 'Registro no encontrado'
      });
    }

    // Obtener configuración de certificado (si existe)
    const [config] = await sql`
      SELECT
        verifactu_certificado_path,
        verifactu_certificado_password
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const resultado = await enviarRegistroAeat(
      registroId,
      entorno,
      config?.verifactu_certificado_path,
      config?.verifactu_certificado_password
    );

    res.json({
      success: resultado.success,
      mensaje: resultado.mensaje,
      registro: registroId,
      detalles: resultado
    });

  } catch (error) {
    console.error('Error en enviarRegistro:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Envía todos los registros pendientes a la AEAT
 * POST /admin/verifactu/enviar-pendientes
 */
export async function enviarPendientes(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { entorno = 'PRUEBAS' } = req.body;

    // Obtener configuración de certificado
    const [config] = await sql`
      SELECT
        verifactu_certificado_path,
        verifactu_certificado_password
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const resultado = await enviarRegistrosPendientes(
      empresaId,
      entorno,
      config?.verifactu_certificado_path,
      config?.verifactu_certificado_password
    );

    res.json({
      success: resultado.enviados > 0,
      mensaje: `Enviados: ${resultado.enviados}, Errores: ${resultado.errores}`,
      ...resultado
    });

  } catch (error) {
    console.error('Error en enviarPendientes:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Prueba la conexión con la AEAT
 * POST /admin/verifactu/test-conexion
 */
export async function probarConexion(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { entorno = 'PRUEBAS' } = req.body;

    // Obtener configuración de certificado
    const [config] = await sql`
      SELECT
        verifactu_certificado_path,
        verifactu_certificado_password
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const resultado = await testConexionAeat(
      entorno,
      config?.verifactu_certificado_path,
      config?.verifactu_certificado_password
    );

    res.json(resultado);

  } catch (error) {
    console.error('Error en probarConexion:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Reintenta enviar los registros con error
 * POST /admin/verifactu/reintentar-errores
 */
export async function reintentarErrores(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { entorno = 'PRUEBAS' } = req.body;

    // Marcar registros con ERROR como PENDIENTE
    await sql`
      UPDATE registroverifactu_180
      SET estado_envio = 'PENDIENTE',
          respuesta_aeat = NULL
      WHERE empresa_id = ${empresaId}
        AND estado_envio = 'ERROR'
    `;

    // Enviar pendientes
    const [config] = await sql`
      SELECT
        verifactu_certificado_path,
        verifactu_certificado_password
      FROM configuracionsistema_180
      WHERE empresa_id = ${empresaId}
      LIMIT 1
    `;

    const resultado = await enviarRegistrosPendientes(
      empresaId,
      entorno,
      config?.verifactu_certificado_path,
      config?.verifactu_certificado_password
    );

    res.json({
      success: true,
      mensaje: 'Reintento completado',
      ...resultado
    });

  } catch (error) {
    console.error('Error en reintentarErrores:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Obtiene detalles de un registro específico
 * GET /admin/verifactu/registro/:registroId
 */
export async function obtenerDetalleRegistro(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const { registroId } = req.params;

    const [registro] = await sql`
      SELECT
        r.*,
        f.numero as numero_factura,
        f.fecha as fecha_factura,
        f.total as total_factura,
        c.nombre as cliente_nombre,
        c.nif as cliente_nif,
        e.nif as emisor_nif,
        e.nombre as emisor_nombre
      FROM registroverifactu_180 r
      LEFT JOIN factura_180 f ON f.id = r.factura_id
      LEFT JOIN clientes_180 c ON c.id = f.cliente_id
      LEFT JOIN emisor_180 e ON e.empresa_id = r.empresa_id
      WHERE r.id = ${registroId}
        AND r.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!registro) {
      return res.status(404).json({
        error: 'Registro no encontrado'
      });
    }

    res.json(registro);

  } catch (error) {
    console.error('Error en obtenerDetalleRegistro:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}

/**
 * Obtiene el estado de cumplimiento VeriFactu
 * GET /admin/verifactu/cumplimiento
 *
 * CRÍTICO: Verifica si la empresa cumple con todos los requisitos
 * necesarios para operar VeriFactu en PRODUCCIÓN.
 */
export async function obtenerCumplimiento(req, res) {
  try {
    const empresaId = await getEmpresaId(req);
    const estado = await obtenerEstadoCumplimiento(empresaId);

    res.json(estado);

  } catch (error) {
    console.error('Error en obtenerCumplimiento:', error);
    res.status(error.status || 500).json({
      error: error.message
    });
  }
}
