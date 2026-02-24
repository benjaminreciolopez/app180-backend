// backend/src/controllers/asesoriaController.js
// Dashboard and client management for the asesor portal
import { sql } from "../db.js";

/**
 * GET /asesor/dashboard
 * Returns summary of all linked clients for the authenticated asesor:
 * - count of active clients
 * - pending invitations
 * - unread messages total
 * - per-client details: empresa_id, nombre, ultimo_acceso, facturas_pendientes, alertas
 */
export async function getDashboard(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    // Count active clients
    const [activeCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND estado = 'activo'
    `;

    // Count pending invitations (both directions)
    const [pendingCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND estado = 'pendiente'
    `;

    // Count total unread messages across all clients (messages sent TO the asesor)
    const [unreadCount] = await sql`
      SELECT COUNT(*)::int AS total
      FROM asesoria_mensajes_180
      WHERE asesoria_id = ${asesoriaId}
        AND autor_tipo != 'asesor'
        AND leido = false
    `;

    // Per-client details for active clients
    const clientes = await sql`
      SELECT
        ac.empresa_id,
        e.nombre,
        (
          SELECT MAX(m.created_at)
          FROM asesoria_mensajes_180 m
          WHERE m.asesoria_id = ${asesoriaId}
            AND m.empresa_id = ac.empresa_id
        ) AS ultimo_acceso,
        (
          SELECT COUNT(*)::int
          FROM factura_180 f
          WHERE f.empresa_id = ac.empresa_id
            AND f.estado = 'BORRADOR'
        ) AS facturas_pendientes,
        (
          SELECT COUNT(*)::int
          FROM asesoria_mensajes_180 m
          WHERE m.asesoria_id = ${asesoriaId}
            AND m.empresa_id = ac.empresa_id
            AND m.autor_tipo != 'asesor'
            AND m.leido = false
        ) AS alertas
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId}
        AND ac.estado = 'activo'
      ORDER BY e.nombre ASC
    `;

    return res.json({
      success: true,
      data: {
        clientes_activos: activeCount.total,
        invitaciones_pendientes: pendingCount.total,
        mensajes_no_leidos: unreadCount.total,
        clientes,
      },
    });
  } catch (err) {
    console.error("Error getDashboard (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo dashboard de asesoría" });
  }
}

/**
 * GET /asesor/clientes
 * List all clients linked to this asesoria
 */
export async function getClientes(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;

    const clientes = await sql`
      SELECT
        ac.id AS vinculo_id,
        ac.empresa_id,
        e.nombre,
        e.cif,
        ac.estado,
        ac.permisos,
        ac.connected_at,
        (
          SELECT u.email
          FROM users_180 u
          WHERE u.id = e.user_id
          LIMIT 1
        ) AS email
      FROM asesoria_clientes_180 ac
      JOIN empresa_180 e ON e.id = ac.empresa_id
      WHERE ac.asesoria_id = ${asesoriaId}
      ORDER BY ac.estado ASC, e.nombre ASC
    `;

    return res.json({ success: true, data: clientes });
  } catch (err) {
    console.error("Error getClientes (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo clientes" });
  }
}

/**
 * GET /asesor/clientes/:empresa_id/resumen
 * Quick summary for one client
 */
export async function getClienteResumen(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    const empresaId = req.params.empresa_id;

    // Validate asesor has active link to this empresa
    const vinculo = await sql`
      SELECT permisos FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId}
        AND empresa_id = ${empresaId}
        AND estado = 'activo'
      LIMIT 1
    `;
    if (vinculo.length === 0) return res.status(403).json({ error: "Sin acceso" });

    const currentYear = new Date().getFullYear();

    // Get empresa name
    const [empresa] = await sql`
      SELECT nombre FROM empresa_180
      WHERE id = ${empresaId}
      LIMIT 1
    `;

    // Total facturas emitidas this year
    const [facturasEmitidas] = await sql`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total), 0)::numeric AS importe
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
    `;

    // Total gastos this year
    const [gastos] = await sql`
      SELECT COUNT(*)::int AS total, COALESCE(SUM(total), 0)::numeric AS importe
      FROM purchases_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
        AND EXTRACT(YEAR FROM fecha_compra) = ${currentYear}
    `;

    // Total empleados activos
    const [empleados] = await sql`
      SELECT COUNT(*)::int AS total
      FROM employees_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
    `;

    // Ultimo modelo fiscal generado
    const ultimoModelo = await sql`
      SELECT modelo, periodo, anio, created_at
      FROM modelos_fiscales_180
      WHERE empresa_id = ${empresaId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return res.json({
      success: true,
      data: {
        nombre: empresa?.nombre || null,
        facturas_emitidas: {
          total: facturasEmitidas.total,
          importe: parseFloat(facturasEmitidas.importe),
        },
        gastos: {
          total: gastos.total,
          importe: parseFloat(gastos.importe),
        },
        empleados_activos: empleados.total,
        ultimo_modelo_fiscal: ultimoModelo[0] || null,
        permisos: vinculo[0].permisos,
        anio: currentYear,
      },
    });
  } catch (err) {
    console.error("Error getClienteResumen (asesoria):", err);
    return res.status(500).json({ error: "Error obteniendo resumen del cliente" });
  }
}
