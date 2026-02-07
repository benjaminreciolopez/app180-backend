// backend/src/controllers/auditController.js
import { sql } from '../db.js';

/**
 * Obtener logs de auditoría con filtros y paginación
 */
export const getAuditLogs = async (req, res) => {
  try {
    const {
      empleado_id,
      accion,
      fecha_desde,
      fecha_hasta,
      entidad_tipo,
      limit = 100,
      offset = 0
    } = req.query;

    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const empresaId = adminEmpresa[0].id;

    // Construir condiciones WHERE dinámicamente
    let conditions = [`a.empresa_id = ${empresaId}`];
    let params = [];

    if (empleado_id) {
      conditions.push(`a.empleado_id = $${params.length + 1}`);
      params.push(empleado_id);
    }

    if (accion) {
      conditions.push(`a.accion = $${params.length + 1}`);
      params.push(accion);
    }

    if (fecha_desde) {
      conditions.push(`a.created_at >= $${params.length + 1}::timestamptz`);
      params.push(fecha_desde);
    }

    if (fecha_hasta) {
      conditions.push(`a.created_at <= $${params.length + 1}::timestamptz`);
      params.push(fecha_hasta);
    }

    const whereClause = conditions.join(' AND ');

    const isVerifactu = entidad_tipo === 'factura';
    const tableName = isVerifactu ? sql`auditoria_180` : sql`audit_log_180`;

    const logs = await sql`
      SELECT 
        a.*,
        u.email as user_email,
        ${isVerifactu ? sql`null as empleado_nombre` : sql`e.nombre as empleado_nombre`}
      FROM ${tableName} a
      LEFT JOIN users_180 u ON u.id = a.user_id
      ${isVerifactu ? sql`` : sql`LEFT JOIN employees_180 e ON e.id = a.empleado_id`}
      WHERE a.empresa_id = ${empresaId}
        ${empleado_id && !isVerifactu ? sql`AND a.empleado_id = ${empleado_id}` : sql``}
        ${accion ? sql`AND a.accion = ${accion}` : sql``}
        ${entidad_tipo ? (isVerifactu ? sql`AND a.entidad = ${entidad_tipo}` : sql`AND a.entidad_tipo = ${entidad_tipo}`) : sql``}
        ${fecha_desde ? sql`AND a.created_at >= ${fecha_desde}::timestamptz` : sql``}
        ${fecha_hasta ? sql`AND a.created_at <= ${fecha_hasta}::timestamptz` : sql``}
      ORDER BY a.created_at DESC
      LIMIT ${parseInt(limit)}
      OFFSET ${parseInt(offset)}
    `;

    const [countResult] = await sql`
      SELECT COUNT(*) as count
      FROM ${tableName} a
      WHERE a.empresa_id = ${empresaId}
        ${empleado_id && !isVerifactu ? sql`AND a.empleado_id = ${empleado_id}` : sql``}
        ${accion ? sql`AND a.accion = ${accion}` : sql``}
        ${entidad_tipo ? (isVerifactu ? sql`AND a.entidad = ${entidad_tipo}` : sql`AND a.entidad_tipo = ${entidad_tipo}`) : sql``}
        ${fecha_desde ? sql`AND a.created_at >= ${fecha_desde}::timestamptz` : sql``}
        ${fecha_hasta ? sql`AND a.created_at <= ${fecha_hasta}::timestamptz` : sql``}
    `;

    return res.json({
      logs,
      total: parseInt(countResult.count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('❌ Error obteniendo logs:', error);
    return res.status(500).json({ error: 'Error al obtener logs de auditoría' });
  }
};

/**
 * Obtener fichajes rechazados
 */
export const getFichajesRechazados = async (req, res) => {
  try {
    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const empresaId = adminEmpresa[0].id;

    const fichajes = await sql`
      SELECT 
        f.*,
        e.nombre as nombre_empleado,
        c.nombre as nombre_cliente,
        a.created_at as fecha_rechazo,
        a.motivo as motivo_rechazo,
        u.email as rechazado_por
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      LEFT JOIN audit_log_180 a ON a.entidad_id = f.id::text AND a.accion = 'fichaje_rechazado'
      LEFT JOIN users_180 u ON u.id = a.user_id
      WHERE e.empresa_id = ${empresaId}
        AND f.estado = 'rechazado'
      ORDER BY f.fecha DESC
    `;

    return res.json(fichajes);
  } catch (error) {
    console.error('❌ Error obteniendo fichajes rechazados:', error);
    return res.status(500).json({ error: 'Error al obtener fichajes rechazados' });
  }
};

/**
 * Obtener estadísticas de auditoría
 */
export const getAuditStats = async (req, res) => {
  try {
    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const empresaId = adminEmpresa[0].id;

    // Estadísticas por acción (últimos 30 días)
    const statsByAction = await sql`
      SELECT 
        accion,
        COUNT(*) as total,
        COUNT(DISTINCT empleado_id) as empleados_afectados
      FROM audit_log_180
      WHERE empresa_id = ${empresaId}
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY accion
      ORDER BY total DESC
    `;

    // Estadísticas por empleado (fichajes rechazados)
    const statsByEmployee = await sql`
      SELECT 
        e.id,
        e.nombre,
        COUNT(*) as total_rechazados
      FROM audit_log_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND a.accion = 'fichaje_rechazado'
        AND a.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY e.id, e.nombre
      ORDER BY total_rechazados DESC
      LIMIT 10
    `;

    // Total de acciones por día (últimos 7 días)
    const dailyActivity = await sql`
      SELECT 
        DATE(created_at) as fecha,
        COUNT(*) as total
      FROM audit_log_180
      WHERE empresa_id = ${empresaId}
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY fecha DESC
    `;

    return res.json({
      by_action: statsByAction,
      by_employee: statsByEmployee,
      daily_activity: dailyActivity
    });
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    return res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
};

/**
 * Eliminar permanentemente un fichaje rechazado
 */
export const eliminarFichajeRechazado = async (req, res) => {
  try {
    const { id } = req.params;

    const adminEmpresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (adminEmpresa.length === 0) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const empresaId = adminEmpresa[0].id;

    // Verificar que el fichaje existe y está rechazado
    const [fichaje] = await sql`
      SELECT f.*, e.empresa_id, e.id as empleado_id
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.id = ${id}
        AND e.empresa_id = ${empresaId}
        AND f.estado = 'rechazado'
    `;

    if (!fichaje) {
      return res.status(404).json({ error: 'Fichaje no encontrado o no está rechazado' });
    }

    // Eliminar el fichaje
    await sql`
      DELETE FROM fichajes_180
      WHERE id = ${id}
    `;

    // Registrar en auditoría
    const { registrarAuditoria } = await import('../middlewares/auditMiddleware.js');
    await registrarAuditoria({
      empresaId,
      userId: req.user.id,
      empleadoId: fichaje.empleado_id,
      accion: 'fichaje_eliminado',
      entidadTipo: 'fichaje',
      entidadId: id,
      datosAnteriores: fichaje,
      datosNuevos: null,
      motivo: 'Eliminado permanentemente tras rechazo',
      req
    });

    return res.json({ success: true, message: 'Fichaje eliminado permanentemente' });
  } catch (error) {
    console.error('❌ Error eliminando fichaje:', error);
    return res.status(500).json({ error: 'Error al eliminar fichaje' });
  }
};
