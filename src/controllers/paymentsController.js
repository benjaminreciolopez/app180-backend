import { sql } from "../db.js";
import {
  asignarPago,
  getPagoPendiente,
} from "../services/paymentAllocationService.js";

async function getEmpresaId(userId) {
  const r =
    await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  if (!r[0]) {
    const e = new Error("Empresa no asociada");
    e.status = 403;
    throw e;
  }
  return r[0].id;
}

export async function crearPago(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const { cliente_id, importe, metodo, fecha_pago, referencia, notas } =
    req.body;

  if (!cliente_id || !importe || !metodo) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const metodosValidos = [
    "transferencia",
    "efectivo",
    "tarjeta",
    "bizum",
    "otro",
  ];
  if (!metodosValidos.includes(metodo)) {
    return res.status(400).json({ error: "Método inválido" });
  }

  if (Number(importe) <= 0) {
    return res.status(400).json({ error: "Importe inválido" });
  }

  // validar cliente pertenece a empresa
  const c = await sql`
    select 1 from clients_180
    where id=${cliente_id} and empresa_id=${empresaId}
  `;
  if (!c[0]) return res.status(404).json({ error: "Cliente no existe" });

  // Asignaciones: [{ work_log_id: "...", importe: 50 }, ...]
  const asignaciones = req.body.asignaciones || [];

  // Iniciar transacción (usamos sql.begin si available, o lógica manual secuencial si postgres.js simple)
  // Postgres.js soporta sql.begin

  try {
    const result = await sql.begin(async sql => {
      // 1. Crear Pago
      const p = await sql`
            insert into payments_180 (
              empresa_id, cliente_id, importe, metodo, fecha_pago, referencia, notas
            )
            values (
              ${empresaId}, ${cliente_id}, ${importe}, ${metodo},
              ${fecha_pago ?? null}, ${referencia ?? null}, ${notas ?? null}
            )
            returning *
          `;
      const payment = p[0];

      // 2. Procesar Asignaciones
      for (const item of asignaciones) {
        if (item.work_log_id && item.importe > 0) {
          // Crear registro allocation
          await sql`
                      insert into payment_allocations_180 (
                          empresa_id, payment_id, work_log_id, importe
                      ) values (
                          ${empresaId}, ${payment.id}, ${item.work_log_id}, ${item.importe}
                      )
                   `;

          // Actualizar work_log
          // pagado = pagado + importe
          // estado = check si pagado >= valor
          await sql`
                      UPDATE work_logs_180
                      SET 
                        pagado = COALESCE(pagado, 0) + ${item.importe},
                        estado_pago = CASE 
                            WHEN (COALESCE(pagado, 0) + ${item.importe}) >= valor THEN 'pagado'
                            ELSE 'parcial'
                        END
                      WHERE id = ${item.work_log_id} AND empresa_id = ${empresaId}
                   `;
        }
      }

      return payment;
    });

    res.status(201).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error procesando pago: " + e.message });
  }
}

export async function listarPagosCliente(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const rows = await sql`
      select p.*, c.nombre as cliente_nombre
      from payments_180 p
      left join clients_180 c on p.cliente_id = c.id
      where p.empresa_id=${empresaId}
        and p.cliente_id=${id}
      order by p.fecha_pago desc, p.created_at desc
    `;

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

export async function listarTodosLosPagos(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);

    const rows = await sql`
      select p.*, c.nombre as cliente_nombre
      from payments_180 p
      left join clients_180 c on p.cliente_id = c.id
      where p.empresa_id=${empresaId}
      order by p.fecha_pago desc, p.created_at desc
    `;

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * Endpoint para tu modal:
 * Devuelve pago + remanente + lista de items pendientes (invoices_180) para seleccionar.
 */
export async function getPendientesParaPago(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { paymentId } = req.params;

  const p = await sql`
    select *
    from payments_180
    where id=${paymentId} and empresa_id=${empresaId}
    limit 1
  `;
  if (!p[0]) return res.status(404).json({ error: "Pago no existe" });

  const rem = await getPagoPendiente({ empresaId, paymentId });
  const clienteId = p[0].cliente_id;

  const pendientes = await sql`
    select id, tipo, work_item_id, referencia, importe_total, importe_pagado, saldo, estado, fecha_emision
    from invoices_180
    where empresa_id=${empresaId}
      and cliente_id=${clienteId}
      and estado in ('pendiente','parcial')
      and saldo > 0
    order by fecha_emision asc, created_at asc
  `;

  res.json({
    pago: p[0],
    remanente: rem,
    pendientes,
  });
}

export async function imputarPago(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { paymentId } = req.params;

  const { cliente_id, asignaciones } = req.body;
  if (!cliente_id || !Array.isArray(asignaciones)) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const r = await asignarPago({
    empresaId,
    paymentId,
    clienteId: cliente_id,
    asignaciones,
  });

  res.json(r);
}

/**
 * GET /admin/clientes/:id/trabajos-pendientes
 * Devuelve worklogs con deuda (val - pagado > 0)
 */
export async function getTrabajosPendientes(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params; // clienteId

  const rows = await sql`
        SELECT * 
        FROM work_logs_180
        WHERE empresa_id = ${empresaId}
          AND cliente_id = ${id}
          AND (valor > COALESCE(pagado, 0))
        ORDER BY fecha ASC
    `;
  res.json(rows);
}
