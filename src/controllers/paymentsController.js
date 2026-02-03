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
        if (item.importe <= 0) continue;

        if (item.work_log_id) {
          // Asignación a Trabajo
          await sql`
            insert into payment_allocations_180 (
                empresa_id, payment_id, work_log_id, importe
            ) values (
                ${empresaId}, ${payment.id}, ${item.work_log_id}, ${item.importe}
            )
          `;

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
        } else if (item.factura_id) {
          // Asignación a Factura
          await sql`
            insert into payment_allocations_180 (
                empresa_id, payment_id, factura_id, importe
            ) values (
                ${empresaId}, ${payment.id}, ${item.factura_id}, ${item.importe}
            )
          `;

          await sql`
            UPDATE factura_180
            SET 
              pagado = COALESCE(pagado, 0) + ${item.importe},
              estado_pago = CASE 
                  WHEN (COALESCE(pagado, 0) + ${item.importe}) >= total THEN 'pagado'
                  ELSE 'parcial'
              END
            WHERE id = ${item.factura_id} AND empresa_id = ${empresaId}
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
 * GET /admin/clientes/:id/deudas-pendientes
 * Devuelve un mix de facturas y trabajos sin facturar que tienen deuda pendiente
 */
export async function getTrabajosPendientes(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params; // clienteId

    const deudas = [];

    // 1. Facturas Validadas con Saldo
    const facturas = await sql`
      SELECT 
        id, 
        numero, 
        fecha, 
        total as valor, 
        pagado, 
        estado_pago,
        'factura' as tipo,
        'Factura ' || numero as descripcion
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND cliente_id = ${id}
        AND estado = 'VALIDADA'
        AND (total > COALESCE(pagado, 0))
    `;
    deudas.push(...facturas);

    // 2. Trabajos sin Factura con Saldo
    const trabajos = await sql`
      SELECT 
        id,
        fecha,
        valor,
        pagado,
        estado_pago,
        'trabajo' as tipo,
        descripcion
      FROM work_logs_180
      WHERE empresa_id = ${empresaId}
        AND cliente_id = ${id}
        AND factura_id IS NULL
        AND (valor > COALESCE(pagado, 0))
    `;
    deudas.push(...trabajos);

    // Ordenar por fecha
    deudas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    res.json(deudas);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

export async function getPagoDetalle(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    const pago = await sql`
      select p.*, c.nombre as cliente_nombre
      from payments_180 p
      left join clients_180 c on p.cliente_id = c.id
      where p.id=${id} and p.empresa_id=${empresaId}
    `;

    if (!pago[0]) return res.status(404).json({ error: "Pago no existe" });

    const asignaciones = await sql`
      select a.*, 
             f.numero as factura_numero,
             w.descripcion as trabajo_descripcion,
             i.referencia as invoice_referencia
      from payment_allocations_180 a
      left join factura_180 f on a.factura_id = f.id
      left join work_logs_180 w on a.work_log_id = w.id
      left join invoices_180 i on a.invoice_id = i.id
      where a.payment_id=${id} and a.empresa_id=${empresaId}
    `;

    res.json({
      pago: pago[0],
      asignaciones
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

export async function eliminarPago(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { id } = req.params;

    await sql.begin(async (sql) => {
      // 1. Obtener asignaciones para revertirlas
      const asignaciones = await sql`
        select * from payment_allocations_180 
        where payment_id = ${id} and empresa_id = ${empresaId}
      `;

      for (const a of asignaciones) {
        if (a.work_log_id) {
          await sql`
            UPDATE work_logs_180
            SET 
              pagado = GREATEST(0, COALESCE(pagado, 0) - ${a.importe}),
              estado_pago = CASE 
                  WHEN (COALESCE(pagado, 0) - ${a.importe}) <= 0 THEN 'pendiente'
                  ELSE 'parcial'
              END
            WHERE id = ${a.work_log_id} AND empresa_id = ${empresaId}
          `;
        } else if (a.factura_id) {
          await sql`
            UPDATE factura_180
            SET 
              pagado = GREATEST(0, COALESCE(pagado, 0) - ${a.importe}),
              estado_pago = CASE 
                  WHEN (COALESCE(pagado, 0) - ${a.importe}) <= 0 THEN 'pendiente'
                  ELSE 'parcial'
              END
            WHERE id = ${a.factura_id} AND empresa_id = ${empresaId}
          `;
        } else if (a.invoice_id) {
          await sql`
                UPDATE invoices_180
                SET
                    importe_pagado = GREATEST(0, COALESCE(importe_pagado, 0) - ${a.importe}),
                    saldo = saldo + ${a.importe},
                    estado = CASE
                        WHEN (COALESCE(importe_pagado, 0) - ${a.importe}) <= 0 THEN 'pendiente'
                        ELSE 'parcial'
                    END
                WHERE id = ${a.invoice_id} AND empresa_id = ${empresaId}
             `;
        }
      }

      // 2. Borrar asignaciones
      await sql`delete from payment_allocations_180 where payment_id = ${id} and empresa_id = ${empresaId}`;

      // 3. Borrar el pago
      await sql`delete from payments_180 where id = ${id} and empresa_id = ${empresaId}`;
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error eliminando pago: " + e.message });
  }
}
