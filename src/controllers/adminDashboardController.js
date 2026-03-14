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
    let facturacionMensual = { este_mes: 0, mes_anterior: 0, ytd: 0 };
    let gastosMensuales = { este_mes: 0, mes_anterior: 0, ytd: 0 };

    if (modulos.facturacion !== false) {
      // Facturación este mes, mes anterior y YTD
      const [facMes] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND tipo_factura != 'PROFORMA'
          AND fecha >= DATE_TRUNC('month', CURRENT_DATE)
      `;
      const [facMesAnt] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND tipo_factura != 'PROFORMA'
          AND fecha >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND fecha < DATE_TRUNC('month', CURRENT_DATE)
      `;
      const [facYtd] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND tipo_factura != 'PROFORMA'
          AND fecha >= DATE_TRUNC('year', CURRENT_DATE)
      `;
      facturacionMensual = {
        este_mes: Number(facMes.total),
        mes_anterior: Number(facMesAnt.total),
        ytd: Number(facYtd.total),
      };

      // Gastos este mes, mes anterior y YTD
      const [gasMes] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
          AND fecha >= DATE_TRUNC('month', CURRENT_DATE)
      `;
      const [gasMesAnt] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
          AND fecha >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND fecha < DATE_TRUNC('month', CURRENT_DATE)
      `;
      const [gasYtd] = await sql`
        SELECT COALESCE(SUM(base_imponible), 0)::numeric AS total
        FROM purchases_180
        WHERE empresa_id = ${empresaId}
          AND fecha >= DATE_TRUNC('year', CURRENT_DATE)
      `;
      gastosMensuales = {
        este_mes: Number(gasMes.total),
        mes_anterior: Number(gasMesAnt.total),
        ytd: Number(gasYtd.total),
      };
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
    let trabajosPendientesList = [];
    let partesHoy = 0;

    if (modulos.partes_dia !== false) {
      // Trabajos pendientes: Cualquier trabajo cuyo estado_pago no sea 'pagado'
      const [{ count = 0 }] = await sql`
        SELECT COUNT(*)::int AS count
        FROM work_logs_180 w
        WHERE w.empresa_id = ${empresaId}
          AND COALESCE(w.estado_pago, 'pendiente') != 'pagado'
      `;
      trabajosPendientes = count;

      // Lista de trabajos pendientes para el modal
      trabajosPendientesList = await sql`
        SELECT 
          w.id,
          w.descripcion,
          w.fecha,
          w.cliente_id,
          c.nombre as cliente_nombre,
          w.estado_pago,
          CASE 
             WHEN w.estado_pago = 'pendiente' OR w.estado_pago IS NULL THEN 'PENDIENTE'
             WHEN w.estado_pago = 'parcial' THEN 'PAGO_PARCIAL'
             ELSE w.estado_pago 
          END as estado_detalle
        FROM work_logs_180 w
        LEFT JOIN clients_180 c ON w.cliente_id = c.id
        WHERE w.empresa_id = ${empresaId}
          AND COALESCE(w.estado_pago, 'pendiente') != 'pagado'
        ORDER BY w.fecha DESC
      `;

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
          oauth2_connected_at,
          last_sync_at,
          sync_enabled
        FROM empresa_calendar_config_180
        WHERE empresa_id = ${empresaId}
      `;

      if (config) {
        calendarioSyncStatus = {
          connected: !!config.oauth2_connected_at,
          lastSync: config.last_sync_at,
          enabled: config.sync_enabled || false
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
      // ... (código existente fichajes) ...
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
       BENEFICIO REAL (Financiero Año Actual)
    ========================= */
    let beneficioReal = {
      facturado_base: 0,
      gastos_base: 0,
      impuestos_estimados: 0,
      beneficio_neto: 0,
      pendiente_facturar: 0,
      year: new Date().getFullYear()
    };

    if (modulos.facturacion !== false) {
      const currentYear = new Date().getFullYear();
      const startDate = `${currentYear}-01-01`;
      const endDate = `${currentYear}-12-31`;

      const calc = await calculateBeneficio(empresaId, startDate, endDate);

      beneficioReal = {
        ...calc,
        year: currentYear
      };
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
      facturacionMensual,
      gastosMensuales,
      trabajosPendientes,
      trabajosPendientesList: trabajosPendientesList || [],
      partesHoy,
      calendarioSyncStatus,
      facturasPendientesList: await getFacturasPendientesList(empresaId, modulos.facturacion),
      beneficioReal,
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

async function getFacturasPendientesList(empresaId, moduloFacturacion) {
  if (moduloFacturacion === false) return [];

  try {
    const rows = await sql`
      SELECT 
        f.id, 
        f.numero, 
        f.total, 
        f.fecha as fecha_emision, 
        c.nombre as cliente_nombre,
        f.estado_pago
      FROM factura_180 f
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      WHERE f.empresa_id = ${empresaId}
        AND f.estado = 'VALIDADA'
        AND COALESCE(f.estado_pago, 'pendiente') IN ('pendiente', 'parcial')
      ORDER BY f.fecha DESC
      LIMIT 10
    `;
    return rows;
  } catch (e) {
    console.error("Error fetching facturas pendientes list", e);
    return [];
  }
}

/**
 * Helper para calcular beneficio en un rango.
 * Solo usa datos FISCALMENTE declarados (facturas emitidas y gastos deducibles).
 * También indica trabajo cobrado pero pendiente de facturar como aviso informativo.
 */
async function calculateBeneficio(empresaId, startDate, endDate) {
  // 1. Facturado (Base Imponible de facturas emitidas válidas)
  const [fact] = await sql`
      SELECT COALESCE(SUM(subtotal), 0) as total
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND fecha BETWEEN ${startDate} AND ${endDate}
        AND estado NOT IN ('BORRADOR', 'ANULADA')
    `;

  // 2. Gastos deducibles (Base Imponible)
  const [gast] = await sql`
      SELECT COALESCE(SUM(base_imponible), 0) as total
      FROM purchases_180
      WHERE empresa_id = ${empresaId}
        AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        AND activo = true
    `;

  // 3. Trabajo cobrado pero pendiente de facturar (solo informativo, NO suma al beneficio)
  const [pendiente] = await sql`
      SELECT COALESCE(SUM(valor), 0) as total
      FROM work_logs_180
      WHERE empresa_id = ${empresaId}
        AND fecha BETWEEN ${startDate} AND ${endDate}
        AND estado_pago = 'pagado'
        AND factura_id IS NULL
    `;

  const facturado = Number(fact.total);
  const gastos = Number(gast.total);
  const pendienteFacturar = Number(pendiente.total);

  // 4. Estimación IRPF Modelo 130 (20% del rendimiento neto positivo)
  const rendimientoNeto = facturado - gastos;
  const impuestos = rendimientoNeto > 0 ? rendimientoNeto * 0.20 : 0;

  // 5. Beneficio neto = Ingresos facturados - Gastos - Impuestos estimados
  const beneficioNeto = facturado - gastos - impuestos;

  return {
    facturado_base: facturado,
    gastos_base: gastos,
    impuestos_estimados: impuestos,
    beneficio_neto: beneficioNeto,
    pendiente_facturar: pendienteFacturar,
  };
}

/**
 * Endpoint específico para widget de beneficio con filtros
 */
export const getBeneficioReal = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "No empresa" });

    const now = new Date();
    let year = parseInt(req.query.year) || now.getFullYear();
    let startDate, endDate;
    const period = req.query.period || 'year';

    // Helper fechas (local time safe)
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (period === 'quarter') {
      // trimestre 1-4
      const q = parseInt(req.query.quarter) || Math.floor((now.getMonth() + 3) / 3);
      const startMonth = (q - 1) * 3;
      startDate = fmt(new Date(year, startMonth, 1));
      // Último día del trimestre: (year, startMonth+3, 0)
      // Ojo: JS Month is 0-indexed.
      // startMonth=0 (Jan). endMonth=3 (Apr). Date(2024, 3, 0) -> Mar 31.
      endDate = fmt(new Date(year, startMonth + 3, 0));
    } else if (period === 'month') {
      const m = parseInt(req.query.month) || (now.getMonth() + 1);
      startDate = fmt(new Date(year, m - 1, 1));
      endDate = fmt(new Date(year, m, 0));
    } else {
      // Year
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    const calc = await calculateBeneficio(empresaId, startDate, endDate);

    res.json({
      ...calc,
      startDate,
      endDate,
      period,
      year
    });

  } catch (e) {
    console.error("❌ getBeneficioReal:", e);
    res.status(500).json({ error: "Error calculando beneficio" });
  }
};
