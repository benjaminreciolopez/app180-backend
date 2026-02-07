import { sql } from "../db.js";

/**
 * Dashboard admin (module-aware)
 */
export const getAdminDashboard = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const modulos = req.user.modulos || {};

    if (!empresaId) {
      return res.status(400).json({ error: "Admin sin empresa asignada" });
    }

    /* =========================
       Defaults
    ========================= */

    let empleadosActivos = 0;
    let fichajesHoy = 0;
    let sospechososHoy = 0;

    let trabajandoAhora = [];
    let ultimosFichajes = [];

    /* =========================
       EMPLEADOS
    ========================= */

    if (modulos.empleados !== false) {
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM employees_180
        WHERE empresa_id = ${empresaId}
          AND activo = true
      `;

      empleadosActivos = count;
    }

    /* =========================
       FICHAJES
    ========================= */

    if (modulos.fichajes !== false) {
      // fichajes hoy
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM fichajes_180
        WHERE empresa_id = ${empresaId}
          AND fecha::date = CURRENT_DATE
      `;

      fichajesHoy = count;

      // sospechosos
      const [{ count: sospechosos = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM fichajes_180
        WHERE empresa_id = ${empresaId}
          AND sospechoso = true
          AND fecha::date = CURRENT_DATE
      `;

      sospechososHoy = sospechosos;

      // trabajando ahora
      trabajandoAhora = await sql`
        WITH ultimos AS (
          SELECT
            f.*,
            ROW_NUMBER() OVER (
              PARTITION BY f.empleado_id
              ORDER BY f.fecha DESC
            ) AS rn
          FROM fichajes_180 f
          WHERE f.empresa_id = ${empresaId}
        )
        SELECT
          u.empleado_id,
          u.fecha AS desde,
          e.nombre AS empleado_nombre
        FROM ultimos u
        JOIN employees_180 e ON e.id = u.empleado_id
        WHERE u.rn = 1
          AND u.tipo = 'entrada'
        ORDER BY u.fecha DESC
        LIMIT 20
      `;

      // últimos fichajes
      ultimosFichajes = await sql`
        SELECT
          f.id,
          f.tipo,
          f.fecha,
          e.nombre AS empleado_nombre
        FROM fichajes_180 f
        JOIN employees_180 e ON e.id = f.empleado_id
        WHERE f.empresa_id = ${empresaId}
        ORDER BY f.fecha DESC
        LIMIT 10
      `;
    }

    /* =========================
       CLIENTES
    ========================= */

    let clientesActivos = 0;
    let clientesNuevos = 0;

    if (modulos.clientes !== false) {
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM clients_180
        WHERE empresa_id = ${empresaId}
          AND activo = true
      `;
      clientesActivos = count;

      const [{ count: nuevos = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM clients_180
        WHERE empresa_id = ${empresaId}
          AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
      `;
      clientesNuevos = nuevos;
    }

    /* =========================
       FACTURACIÓN / PAGOS
    ========================= */

    let facturasPendientes = 0;
    let cobrosPendientes = 0;
    let saldoTotal = 0;

    if (modulos.facturacion !== false) {
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND COALESCE(estado_pago, 'pendiente') IN ('pendiente', 'parcial')
      `;
      facturasPendientes = count;

      const [{ saldo = 0 }] = await sql`
        SELECT COALESCE(SUM(total - COALESCE(pagado, 0)), 0)::numeric AS saldo
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND COALESCE(estado_pago, 'pendiente') IN ('pendiente', 'parcial')
      `;
      saldoTotal = Number(saldo);

      const [{ count: cobros = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND COALESCE(estado_pago, 'pendiente') = 'pendiente'
      `;
      cobrosPendientes = cobros;
    }

    /* =========================
       TRABAJOS / PARTES
    ========================= */

    let trabajosPendientes = 0;
    let partesHoy = 0;

    if (modulos.partes_dia !== false) {
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM work_logs_180
        WHERE empresa_id = ${empresaId}
          AND factura_id IS NULL
      `;
      trabajosPendientes = count;

      const [{ count: partes = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM partes_dia_180
        WHERE empresa_id = ${empresaId}
          AND fecha = CURRENT_DATE
      `;
      partesHoy = partes;
    }

    /* =========================
       CALENDARIO GOOGLE
    ========================= */

    let calendarioSyncStatus = null;

    if (modulos.calendario !== false) {
      const [config] = await sql`
        SELECT
          google_calendar_connected,
          google_calendar_last_sync,
          google_calendar_sync_enabled
        FROM empresa_180
        WHERE id = ${empresaId}
      `;

      if (config) {
        calendarioSyncStatus = {
          connected: config.google_calendar_connected || false,
          lastSync: config.google_calendar_last_sync,
          enabled: config.google_calendar_sync_enabled || false
        };
      }
    }

    /* =========================
       NUEVAS MÉTRICAS (Estadísticas)
    ========================= */

    let fichajesUltimosDias = [];
    let fichajesPorTipoHoy = [];
    let topClientesSemana = [];

    if (modulos.fichajes !== false) {
      // 1. Fichajes últimos 7 días
      fichajesUltimosDias = await sql`
        SELECT 
          to_char(fecha, 'YYYY-MM-DD') as dia,
          COUNT(*)::int as cantidad
        FROM fichajes_180
        WHERE empresa_id = ${empresaId}
          AND fecha >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY dia
        ORDER BY dia ASC
      `;

      // 2. Distribución tipos hoy
      fichajesPorTipoHoy = await sql`
        SELECT 
          tipo, 
          COUNT(*)::int as cantidad
        FROM fichajes_180
        WHERE empresa_id = ${empresaId}
          AND fecha::date = CURRENT_DATE
        GROUP BY tipo
      `;
      
      // 3. Top Clientes (últimos 7 días)
      if (modulos.clientes !== false) {
        topClientesSemana = await sql`
          SELECT 
            c.nombre, 
            COUNT(*)::int as total
          FROM fichajes_180 f
          JOIN clients_180 c ON f.cliente_id = c.id
          WHERE f.empresa_id = ${empresaId}
            AND f.fecha >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY c.nombre
          ORDER BY total DESC
          LIMIT 5
        `;
      }
    }

    /* =========================
       RESPONSE
    ========================= */

    return res.json({
      empleadosActivos,
      fichajesHoy,
      sospechososHoy,
      trabajandoAhora,
      ultimosFichajes,
      clientesActivos,
      clientesNuevos,
      facturasPendientes,
      cobrosPendientes,
      saldoTotal,
      trabajosPendientes,
      partesHoy,
      calendarioSyncStatus,
      stats: {
        fichajesUltimosDias,
        fichajesPorTipoHoy,
        topClientesSemana
      }
    });
  } catch (err) {
    console.error("❌ getAdminDashboard:", err);

    return res.status(500).json({
      error: "Error en dashboard admin",
    });
  }
};
