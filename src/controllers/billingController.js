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
  
  // PAGOS
  const pagos = await sql`
    SELECT COALESCE(SUM(importe), 0) as total_pagado
    FROM payments_180
    WHERE empresa_id = ${empresaId}
      AND (${cliente_id}::uuid IS NULL OR cliente_id = ${cliente_id}::uuid)
      AND fecha_pago BETWEEN ${d}::date AND ${h}::date
      AND estado != 'anulado'
  `;

  // TRABAJOS (Minutos)
  const trabajos = await sql`
    SELECT 
      w.id,
      w.cliente_id, 
      w.minutos, 
      w.work_item_id,
      tar.precio as tarifa_precio,
      tar.tipo as tarifa_tipo,
      c.nombre as cliente_nombre
    FROM work_logs_180 w
    JOIN clients_180 c ON c.id = w.cliente_id
    -- Intentamos unir con la tarifa por defecto más reciente (muy simplificado)
    LEFT JOIN client_tariffs_180 tar ON tar.cliente_id = w.cliente_id 
        AND tar.activo = true 
        AND tar.tipo = 'hora' -- Asumimos precio hora por defecto para este cálculo rápido
    WHERE w.empresa_id = ${empresaId}
      AND (${cliente_id}::uuid IS NULL OR w.cliente_id = ${cliente_id}::uuid)
      AND w.fecha::date BETWEEN ${d}::date AND ${h}::date
  `;

  // Calcular valor estimado
  let totalValorEstimado = 0;
  
  for (const t of trabajos) {
    if (t.tarifa_precio) {
        // Precio Hora
        const horas = t.minutos / 60;
        totalValorEstimado += horas * Number(t.tarifa_precio);
    }
  }

  res.json({
    total_pagado: Number(pagos[0].total_pagado),
    total_valor_estimado: totalValorEstimado,
    saldo_pendiente_teorico: totalValorEstimado - Number(pagos[0].total_pagado),
    nota: "Cálculo basado en tarifas por hora activas. Ajustar lógica si hay tarifas por día/mes."
  });
}

/**
 * GET /admin/billing/clients?desde=...&hasta=...
 * Lista clientes con su resumen de facturación (deuda, pagado, etc.)
 */
export async function getBillingByClient(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { desde, hasta } = req.query;

  const d = desde || '2000-01-01';
  const h = hasta || '2100-01-01';

  // Obtener lista clientes base
  const clientes = await sql`
      SELECT id, nombre, codigo 
      FROM clients_180 
      WHERE empresa_id = ${empresaId} 
             AND activo = true
      ORDER BY nombre
  `;

  // Esto podría optimizarse con GROUP BY pero para reutilizar lógica mejor iteramos o hacemos query compleja.
  // Query compleja:
  
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
            w.cliente_id,
            SUM(
                (w.minutos::numeric / 60.0) * COALESCE(t.precio, 0)
            ) as valor_estimado
        FROM work_logs_180 w
        LEFT JOIN client_tariffs_180 t ON t.cliente_id = w.cliente_id 
            AND t.activo = true 
            AND t.tipo = 'hora' -- Simplificación tarifa hora
        WHERE w.empresa_id = ${empresaId}
          AND w.fecha::date BETWEEN ${d}::date AND ${h}::date
        GROUP BY w.cliente_id
      )
      SELECT 
        c.id, c.nombre, c.codigo,
        COALESCE(p.total_pagado, 0) as total_pagado,
        COALESCE(v.valor_estimado, 0) as total_valor,
        (COALESCE(v.valor_estimado, 0) - COALESCE(p.total_pagado, 0)) as saldo
      FROM clients_180 c
      LEFT JOIN payments_sum p ON p.cliente_id = c.id
      LEFT JOIN work_val v ON v.cliente_id = c.id
      WHERE c.empresa_id = ${empresaId} 
        AND c.activo = true
      ORDER BY saldo DESC
  `;

  res.json(stats);
}
