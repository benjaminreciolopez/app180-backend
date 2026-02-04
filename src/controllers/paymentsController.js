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

        // Determinar qué ID usar basándose en qué campo viene en el item
        let invoiceIdForAllocation = null;
        let workLogIdForAllocation = null;
        let facturaIdForAllocation = null;

        // Helper para verificar si es UUID
        const isUuid = (val) => val && typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

        // Helper para verificar si es número entero
        const isInteger = (val) => val && (typeof val === 'number' || !isNaN(parseInt(val)));

        // Asignar a la columna correcta según el tipo de ID
        if (item.invoice_id && isUuid(item.invoice_id)) {
          invoiceIdForAllocation = item.invoice_id;
        } else if (item.work_log_id && isUuid(item.work_log_id)) {
          workLogIdForAllocation = item.work_log_id;
        } else if (item.factura_id && isInteger(item.factura_id)) {
          facturaIdForAllocation = item.factura_id;
        } else {
          // Intentar inferir del ID combinado (retrocompatibilidad)
          const invId = item.invoice_id || item.work_log_id || item.factura_id;
          if (!invId) continue;

          if (isUuid(invId)) {
            invoiceIdForAllocation = invId;
          } else if (isInteger(invId)) {
            facturaIdForAllocation = invId;
          } else {
            continue;
          }
        }

        // Insertar en allocations usando todas las columnas disponibles
        await sql`
          insert into payment_allocations_180 (
              empresa_id, payment_id, invoice_id, work_log_id, factura_id, importe
          ) values (
              ${empresaId}, ${payment.id},
              ${invoiceIdForAllocation},
              ${workLogIdForAllocation},
              ${facturaIdForAllocation},
              ${item.importe}
          )
        `;

        // Determinar el ID para búsqueda en invoices_180
        const invIdForSearch = invoiceIdForAllocation || workLogIdForAllocation || facturaIdForAllocation;

        // Actualizar tabla de consolidación (invoices_180) - Buscamos por ID real o por ID de item de trabajo
        if (invIdForSearch) {
          await sql`
            UPDATE invoices_180
            SET
              importe_pagado = COALESCE(importe_pagado, 0) + ${item.importe},
              saldo = GREATEST(0, saldo - ${item.importe}),
              estado = CASE
                  WHEN (COALESCE(importe_pagado, 0) + ${item.importe}) >= importe_total - 0.01 THEN 'pagada'
                  ELSE 'parcial'
              END
            WHERE (id::text = ${invIdForSearch}::text OR work_item_id::text = ${invIdForSearch}::text)
              AND empresa_id = ${empresaId}
          `;
        }

        // Actualización Legacy (Opcional pero recomendada si hay otras partes del app usándolas)
        if (workLogIdForAllocation || item.work_log_id) {
          const workLogId = workLogIdForAllocation || item.work_log_id;
          await sql`
            UPDATE work_logs_180
            SET
              pagado = COALESCE(pagado, 0) + ${item.importe},
              estado_pago = CASE
                  WHEN (COALESCE(pagado, 0) + ${item.importe}) >= valor THEN 'pagado'
                  ELSE 'parcial'
              END
            WHERE id = ${workLogId} AND empresa_id = ${empresaId}
          `;
        } else if (facturaIdForAllocation || item.factura_id) {
          const facturaId = facturaIdForAllocation || item.factura_id;

          // 1. Actualizar Factura Legacy Y OBTENER RESULTADO ACTUALIZADO
          const [facturaActualizada] = await sql`
            UPDATE factura_180
            SET
              pagado = COALESCE(pagado, 0) + ${item.importe},
              estado_pago = CASE
                  WHEN (COALESCE(pagado, 0) + ${item.importe}) >= total - 0.01 THEN 'pagado'
                  ELSE 'parcial'
              END
            WHERE id = ${facturaId} AND empresa_id = ${empresaId}
            RETURNING pagado, total, work_log_id
          `;

          // 2. Sincronizar invoices_180 (Consolidación)
          await sql`
            UPDATE invoices_180
            SET
              importe_pagado = COALESCE(importe_pagado, 0) + ${item.importe},
              saldo = GREATEST(0, saldo - ${item.importe}),
              estado = CASE
                  WHEN (COALESCE(importe_pagado, 0) + ${item.importe}) >= importe_total - 0.01 THEN 'pagada'
                  ELSE 'parcial'
              END
            WHERE ((work_item_id::text = ${facturaId}::text AND tipo = 'factura') OR id::text = ${facturaId}::text)
              AND empresa_id = ${empresaId}
          `;

          // 3. Sincronizar Trabajos vinculados (USANDO EL DATO ACTUALIZADO)
          console.log(`[DEBUG] Factura ${facturaId}: Pagado=${facturaActualizada?.pagado}, Total=${facturaActualizada?.total}, WorkLogID=${facturaActualizada?.work_log_id}`);

          if (facturaActualizada && Number(facturaActualizada.pagado) >= Number(facturaActualizada.total) - 0.01) {
            console.log(`[DEBUG] Factura ${facturaId} completada. Actualizando trabajos...`);

            // A. Por link reverso (work_logs.factura_id) - Modo Lista
            const r1 = await sql`
               UPDATE work_logs_180
               SET pagado = valor, estado_pago = 'pagado'
               WHERE factura_id = ${facturaId} AND empresa_id = ${empresaId}
             `;
            console.log(`[DEBUG] Trabajos actualizados por factura_id: ${r1.count}`);

            // B. Por link directo (factura.work_log_id) - Modo Único
            if (facturaActualizada.work_log_id) {
              const r2 = await sql`
                 UPDATE work_logs_180 
                 SET pagado = valor, estado_pago = 'pagado'
                 WHERE id = ${facturaActualizada.work_log_id} AND empresa_id = ${empresaId}
               `;
              console.log(`[DEBUG] Trabajo actualizado por work_log_id: ${r2.count}`);
            }
          } else {
            console.log(`[DEBUG] Factura no pagada completamente (Diff: ${Number(facturaActualizada?.total || 0) - Number(facturaActualizada?.pagado || 0)})`);
          }
        }
      }

      console.log("[DEBUG] Transacción de pago finalizada");
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
        'factura_' || id::text as id, 
        numero, 
        fecha, 
        total::numeric as valor, 
        COALESCE(pagado, 0)::numeric as pagado,
        (total - COALESCE(pagado, 0))::numeric as saldo,
        estado_pago,
        'factura' as tipo,
        'Factura ' || numero as descripcion,
        id::text as original_id
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND cliente_id = ${id}
        AND estado = 'VALIDADA'
        AND (total > COALESCE(pagado, 0) + 0.01)
    `;
    deudas.push(...facturas);

    // 2. Trabajos sin Factura con Saldo
    const trabajos = await sql`
      SELECT 
        'trabajo_' || id::text as id,
        fecha,
        valor::numeric as valor,
        COALESCE(pagado, 0)::numeric as pagado,
        (valor - COALESCE(pagado, 0))::numeric as saldo,
        estado_pago,
        'trabajo' as tipo,
        descripcion,
        id::text as original_id
      FROM work_logs_180
      WHERE empresa_id = ${empresaId}
        AND cliente_id = ${id}
        AND factura_id IS NULL
        AND (valor > COALESCE(pagado, 0) + 0.01)
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
        // 1. Revertir en tabla de consolidación (invoices_180)
        const invId = a.invoice_id || a.work_log_id || a.factura_id;
        if (invId) {
          await sql`
            UPDATE invoices_180
            SET
                importe_pagado = GREATEST(0, COALESCE(importe_pagado, 0) - ${a.importe}),
                saldo = GREATEST(0, saldo + ${a.importe}),
                estado = CASE
                    WHEN (COALESCE(importe_pagado, 0) - ${a.importe}) <= 0 THEN 'pendiente'
                    ELSE 'parcial'
                END
            WHERE (id::text = ${invId}::text OR work_item_id::text = ${invId}::text)
              AND empresa_id = ${empresaId}
          `;
        }

        // 2. Revertir en tablas Legacy
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
        }

        if (a.factura_id) {
          await sql`
            UPDATE factura_180
            SET
              pagado = GREATEST(0, COALESCE(pagado, 0) - ${a.importe}),
              estado_pago = CASE
                  WHEN (COALESCE(pagado, 0) - ${a.importe}) <= 0.01 THEN 'pendiente'
                  ELSE 'parcial'
              END
            WHERE id = ${a.factura_id} AND empresa_id = ${empresaId}
          `;

          // Recalcular pagos de trabajos vinculados basándose en el total de asignaciones restantes
          const f = await sql`select pagado, total, work_log_id from factura_180 where id=${a.factura_id} and empresa_id=${empresaId}`;

          if (f[0]) {
            const facturaActualizada = f[0];
            const totalFactura = Number(facturaActualizada.total);

            // Calcular el total de pagos asignados a esta factura (después de eliminar este pago)
            const totalAsignaciones = await sql`
              SELECT COALESCE(SUM(pa.importe), 0) as total_pagado
              FROM payment_allocations_180 pa
              WHERE pa.factura_id = ${a.factura_id}
                AND pa.empresa_id = ${empresaId}
                AND pa.payment_id != ${id}
            `;

            const totalPagadoReal = Number(totalAsignaciones[0]?.total_pagado || 0);
            const nuevoEstadoPago = totalPagadoReal >= totalFactura - 0.01 ? 'pagado' :
                                   totalPagadoReal > 0 ? 'parcial' : 'pendiente';

            // Actualizar trabajos vinculados con el estado correcto
            if (nuevoEstadoPago === 'pagado') {
              // Si la factura sigue pagada completamente, marcar trabajos como pagados
              await sql`
                UPDATE work_logs_180
                SET pagado = valor, estado_pago = 'pagado'
                WHERE factura_id = ${a.factura_id} AND empresa_id = ${empresaId}
              `;

              if (facturaActualizada.work_log_id) {
                await sql`
                  UPDATE work_logs_180
                  SET pagado = valor, estado_pago = 'pagado'
                  WHERE id = ${facturaActualizada.work_log_id} AND empresa_id = ${empresaId}
                `;
              }
            } else {
              // Si la factura ya no está completamente pagada, resetear trabajos
              await sql`
                UPDATE work_logs_180
                SET pagado = 0, estado_pago = 'pendiente'
                WHERE factura_id = ${a.factura_id} AND empresa_id = ${empresaId}
              `;

              if (facturaActualizada.work_log_id) {
                await sql`
                  UPDATE work_logs_180
                  SET pagado = 0, estado_pago = 'pendiente'
                  WHERE id = ${facturaActualizada.work_log_id} AND empresa_id = ${empresaId}
                `;
              }
            }
          }
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
