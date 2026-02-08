import { sql } from "../db.js";

async function getEmpresaId(userId) {
  const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  if (!r[0]) throw new Error("Empresa no asociada");
  return r[0].id;
}

/**
 * GET /admin/billing/status?cliente_id=...&desde=...&hasta=...
 * Devuelve:
 * - Total Trabajos Valorados (Teórico)
 * - Total Pagos Recibidos
 * - Saldo Pendiente (Aproximado, basado en trabajos vs pagos)
 */
export async function getBillingStatus(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { cliente_id, desde, hasta } = req.query;

  const d = desde || '2000-01-01';
  const h = hasta || '2100-01-01';

  // 1. Calcular Valor de Trabajos (Monetización)
  // Estrategia simplificada: Sumar work_logs y multiplicar por tarifa activa o precio manual
  // NOTA: Esto es una estimación. En un sistema real, cada work_log debería "cerrarse" contra una tarifa snapshot.

  /*
    Para hacerlo "bien" sin complicar demasiado:
    Buscamos work_logs en el periodo.
    Para cada uno, buscamos si tiene un precio manual (future feature) o tarifa asociada.
    Si no tiene, buscamos tarifa vigente del cliente para ese tipo de trabajo.
  */

  // Por ahora, vamos a sumar Pagos REALES vs Una estimación simple.

  // 1. Obtener Totales Reales de WorkLogs (con su valor y pagado ya calculados/asignados)
  const workStats = await sql`
    SELECT 
        COALESCE(SUM(valor), 0) as total_valor,
        COALESCE(SUM(pagado), 0) as total_pagado
    FROM work_logs_180
    WHERE empresa_id = ${empresaId}
      AND (${cliente_id}::uuid IS NULL OR cliente_id = ${cliente_id}::uuid)
      AND fecha::date BETWEEN ${d}::date AND ${h}::date
  `;

  // Nota: total_pagado en work_logs debería coincidir con la suma de payment_allocations, 
  // pero el pago global (payments_180) puede ser mayor si hay un anticipo no asignado ('on account').
  // Por eso, para "Total Pagado" real (flujo de caja), usamos payments_180.
  // Para "Deuda", usamos (work_logs.valor - work_logs.pagado).
  // OJO: Si el cliente paga por adelantado, tiene saldo a favor en payments_180 pero work_logs.pagado es 0.

  // Decisión:
  // Saldo Pendiente = (Suma Valor Trabajo) - (Suma Pagos Totales).
  // Si da negativo, es saldo a favor.

  const pagos = await sql`
    SELECT COALESCE(SUM(importe), 0) as total_pagado
    FROM payments_180
    WHERE empresa_id = ${empresaId}
      AND (${cliente_id}::uuid IS NULL OR cliente_id = ${cliente_id}::uuid)
      AND fecha_pago BETWEEN ${d}::date AND ${h}::date
      AND estado != 'anulado'
  `;

  const totalValor = Number(workStats[0].total_valor);
  const totalPagadoReal = Number(pagos[0].total_pagado);

  res.json({
    total_pagado: totalPagadoReal,
    total_valor_estimado: totalValor,
    saldo_pendiente_teorico: totalValor - totalPagadoReal,
    nota: "Cálculo real basado en valores asignados a trabajos."
  });
}

/**
 * GET /admin/billing/clients?desde=...&hasta=...
 */
export async function getBillingByClient(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { desde, hasta } = req.query;

  const d = desde || '2000-01-01';
  const h = hasta || '2100-01-01';

  const stats = await sql`
      WITH payments_sum AS (
        SELECT cliente_id, SUM(importe) as total_pagado
        FROM payments_180
        WHERE empresa_id = ${empresaId}
          AND fecha_pago BETWEEN ${d}::date AND ${h}::date
          AND estado != 'anulado'
        GROUP BY cliente_id
      ),
      work_val AS (
        SELECT 
            cliente_id,
            SUM(valor) as total_valor
        FROM work_logs_180
        WHERE empresa_id = ${empresaId}
          AND fecha::date BETWEEN ${d}::date AND ${h}::date
        GROUP BY cliente_id
      )
      SELECT 
        c.id, c.nombre, c.codigo,
        COALESCE(p.total_pagado, 0) as total_pagado,
        COALESCE(v.total_valor, 0) as total_valor,
        (COALESCE(v.total_valor, 0) - COALESCE(p.total_pagado, 0)) as saldo
      FROM clients_180 c
      LEFT JOIN payments_sum p ON p.cliente_id = c.id
      LEFT JOIN work_val v ON v.cliente_id = c.id
      WHERE c.empresa_id = ${empresaId} 
        AND c.activo = true
      ORDER BY saldo DESC
  `;

  res.json(stats);
}

/**
 * GET /admin/billing/deudas-pendientes
 * Devuelve un resumen consolidado de deudas por cliente:
 * - Deuda en Facturas validadas
 * - Deuda en Trabajos sin facturar
 */
export async function getDeudasPendientesConsolidado(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { desde, hasta, cliente_id } = req.query;

    const d = desde || '2000-01-01';
    const h = hasta || '2100-01-01';

    const rows = await sql`
      WITH deudas_facturas AS (
        SELECT 
          cliente_id,
          SUM(total - COALESCE(pagado, 0)) as deuda_facturas,
          MAX(fecha) as ultima_factura
        FROM factura_180
        WHERE empresa_id = ${empresaId}
          AND estado = 'VALIDADA'
          AND (total > COALESCE(pagado, 0) + 0.01)
          AND fecha::date BETWEEN ${d}::date AND ${h}::date
        GROUP BY cliente_id
      ),
      deudas_trabajos AS (
        SELECT 
          cliente_id,
          SUM(valor - COALESCE(pagado, 0)) as deuda_trabajos,
          MAX(fecha) as ultimo_trabajo
        FROM work_logs_180
        WHERE empresa_id = ${empresaId}
          AND factura_id IS NULL
          AND (valor > COALESCE(pagado, 0) + 0.01)
          AND fecha::date BETWEEN ${d}::date AND ${h}::date
        GROUP BY cliente_id
      )
      SELECT 
        c.id as cliente_id,
        c.nombre as cliente_nombre,
        c.codigo as cliente_codigo,
        COALESCE(f.deuda_facturas, 0)::numeric as deuda_facturas,
        COALESCE(t.deuda_trabajos, 0)::numeric as deuda_trabajos,
        (COALESCE(f.deuda_facturas, 0) + COALESCE(t.deuda_trabajos, 0))::numeric as deuda_total,
        GREATEST(f.ultima_factura, t.ultimo_trabajo) as ultima_actividad
      FROM clients_180 c
      LEFT JOIN deudas_facturas f ON f.cliente_id = c.id
      LEFT JOIN deudas_trabajos t ON t.cliente_id = c.id
      WHERE c.empresa_id = ${empresaId}
        AND c.activo = true
        AND (${cliente_id}::uuid IS NULL OR c.id = ${cliente_id}::uuid)
        AND (f.deuda_facturas > 0 OR t.deuda_trabajos > 0)
      ORDER BY deuda_total DESC
    `;

    res.json(rows);
  } catch (e) {
    console.error("❌ getDeudasPendientesConsolidado:", e);
    res.status(500).json({ error: e.message });
  }
}
