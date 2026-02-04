import { sql } from "../db.js";

/**
 * Calcula el remanente de un pago: importe - sum(allocations)
 */
export async function getPagoPendiente({ empresaId, paymentId }) {
  const r = await sql`
    select
      p.importe as importe_pago,
      coalesce(sum(a.importe), 0) as imputado
    from payments_180 p
    left join payment_allocations_180 a
      on a.payment_id = p.id
      and a.empresa_id = p.empresa_id
    where p.id=${paymentId}
      and p.empresa_id=${empresaId}
    group by p.importe
  `;

  if (!r[0]) return null;

  const importePago = Number(r[0].importe_pago);
  const imputado = Number(r[0].imputado);
  return {
    importe_pago: importePago,
    imputado,
    pendiente: Math.max(0, importePago - imputado),
  };
}

/**
 * Imputa un pago contra varias invoices (total o parcial).
 * asignaciones: [{ invoice_id, importe }]
 */
export async function asignarPago({
  empresaId,
  paymentId,
  clienteId,
  asignaciones,
}) {
  if (!Array.isArray(asignaciones) || asignaciones.length === 0) {
    const e = new Error("Sin asignaciones");
    e.status = 400;
    throw e;
  }

  return await sql.begin(async (tx) => {
    // Bloqueo del pago
    const pagoR = await tx`
      select id, importe, estado, cliente_id
      from payments_180
      where id=${paymentId}
        and empresa_id=${empresaId}
      for update
    `;

    const pago = pagoR[0];
    if (!pago) {
      const e = new Error("Pago no existe");
      e.status = 404;
      throw e;
    }

    if (pago.estado === "anulado") {
      const e = new Error("Pago anulado");
      e.status = 409;
      throw e;
    }

    if (String(pago.cliente_id) !== String(clienteId)) {
      const e = new Error("Pago no corresponde al cliente");
      e.status = 403;
      throw e;
    }

    // Remanente actual del pago
    const remR = await tx`
      select
        p.importe as importe_pago,
        coalesce(sum(a.importe), 0) as imputado
      from payments_180 p
      left join payment_allocations_180 a
        on a.payment_id = p.id and a.empresa_id = p.empresa_id
      where p.id=${paymentId} and p.empresa_id=${empresaId}
      group by p.importe
      for update
    `;

    const importePago = Number(remR[0].importe_pago);
    const imputado = Number(remR[0].imputado);
    let pendientePago = Math.max(0, importePago - imputado);

    // Aplicar asignaciones
    for (const a of asignaciones) {
      const invoiceId = a.invoice_id;
      const imp = Number(a.importe);

      if (!invoiceId || !Number.isFinite(imp) || imp <= 0) {
        const e = new Error("Asignación inválida");
        e.status = 400;
        throw e;
      }

      if (imp > pendientePago + 1e-9) {
        const e = new Error("Importe supera el remanente del pago");
        e.status = 409;
        throw e;
      }

      // Bloqueo invoice
      const invR = await tx`
        select id, cliente_id, importe_total, importe_pagado, saldo, estado
        from invoices_180
        where id=${invoiceId}
          and empresa_id=${empresaId}
          and cliente_id=${clienteId}
          and estado <> 'cancelada'
        for update
      `;

      const inv = invR[0];
      if (!inv) {
        const e = new Error(
          "Trabajo/Factura no existe o no pertenece al cliente",
        );
        e.status = 404;
        throw e;
      }

      const saldoActual = Number(inv.saldo);
      if (saldoActual <= 0) {
        const e = new Error("Este item ya está pagado");
        e.status = 409;
        throw e;
      }

      const aplicar = Math.min(imp, saldoActual);

      // Insert allocation
      await tx`
        insert into payment_allocations_180 (
          empresa_id, payment_id, invoice_id, importe
        )
        values (
          ${empresaId}, ${paymentId}, ${invoiceId}, ${aplicar}
        )
      `;

      // Update invoice
      const nuevoPagado = Number(inv.importe_pagado) + aplicar;
      const nuevoSaldo = Math.max(0, Number(inv.importe_total) - nuevoPagado);
      const nuevoEstado = nuevoSaldo <= 0 ? "pagada" : "parcial";

      await tx`
        update invoices_180
        set
          importe_pagado = ${nuevoPagado},
          saldo = ${nuevoSaldo},
          estado = ${nuevoEstado}
        where id=${invoiceId}
          and empresa_id=${empresaId}
      `;

      // Sincronizar con tablas legacy
      // Obtener información del invoice para saber qué tipo es
      const invoiceInfo = await tx`
        select tipo, work_item_id
        from invoices_180
        where id=${invoiceId} and empresa_id=${empresaId}
      `;

      if (invoiceInfo[0]) {
        const { tipo, work_item_id } = invoiceInfo[0];

        // Si es un trabajo (work_log)
        if (tipo === 'trabajo' && work_item_id) {
          await tx`
            UPDATE work_logs_180
            SET
              pagado = COALESCE(pagado, 0) + ${aplicar},
              estado_pago = CASE
                WHEN (COALESCE(pagado, 0) + ${aplicar}) >= valor THEN 'pagado'
                ELSE 'parcial'
              END
            WHERE id = ${work_item_id} AND empresa_id = ${empresaId}
          `;
        }

        // Si es una factura
        if (tipo === 'factura' && work_item_id) {
          const [facturaActualizada] = await tx`
            UPDATE factura_180
            SET
              pagado = COALESCE(pagado, 0) + ${aplicar},
              estado_pago = CASE
                WHEN (COALESCE(pagado, 0) + ${aplicar}) >= total - 0.01 THEN 'pagado'
                ELSE 'parcial'
              END
            WHERE id = ${work_item_id} AND empresa_id = ${empresaId}
            RETURNING pagado, total, work_log_id
          `;

          // Si la factura está completamente pagada, actualizar trabajos vinculados
          if (facturaActualizada && Number(facturaActualizada.pagado) >= Number(facturaActualizada.total) - 0.01) {
            // Actualizar trabajos por link reverso (work_logs.factura_id)
            await tx`
              UPDATE work_logs_180
              SET pagado = valor, estado_pago = 'pagado'
              WHERE factura_id = ${work_item_id} AND empresa_id = ${empresaId}
            `;

            // Actualizar trabajo por link directo (factura.work_log_id)
            if (facturaActualizada.work_log_id) {
              await tx`
                UPDATE work_logs_180
                SET pagado = valor, estado_pago = 'pagado'
                WHERE id = ${facturaActualizada.work_log_id} AND empresa_id = ${empresaId}
              `;
            }
          }
        }
      }

      pendientePago = Math.max(0, pendientePago - aplicar);
    }

    // Estado del pago (si se imputó algo, queda conciliado; si no, registrado)
    const remFinal = pendientePago;
    const nuevoEstadoPago =
      importePago - imputado > 0 && remFinal === importePago - imputado
        ? "registrado"
        : "conciliado";

    await tx`
      update payments_180
      set estado = ${nuevoEstadoPago}
      where id=${paymentId} and empresa_id=${empresaId}
    `;

    return {
      ok: true,
      pendiente_pago: remFinal,
    };
  });
}
