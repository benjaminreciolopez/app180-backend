// backend/src/services/billingEngine.js

import { sql } from "../db.js";
import { getWorkContext } from "./workContextService.js";

export async function generarInvoicesPeriodo({
  empresaId,
  clienteId,
  desde,
  hasta,
}) {
  /* ========================
     1. Tarifa activa
  ======================== */

  const ctx = await getWorkContext({
    empresaId,
    clienteId,
    fecha: desde,
  });

  const tarifaMes = ctx.tarifas.mes;
  const tarifaHora = ctx.tarifas.hora;
  const tarifaTrabajo = ctx.tarifas.trabajo;

  const invoices = [];

  /* ========================
     2. Mensual
  ======================== */

  if (tarifaMes) {
    invoices.push({
      tipo: "mes",
      work_item_id: null,
      referencia: `Cuota ${desde.slice(0, 7)}`,
      importe: tarifaMes.precio,
    });

    return invoices; // prioridad máxima
  }

  /* ========================
     3. Trabajos
  ======================== */

  const trabajos = await sql`
    select
      wl.work_item_id,
      sum(wl.minutos) as minutos
    from work_logs_180 wl
    where wl.empresa_id=${empresaId}
      and wl.cliente_id=${clienteId}
      and wl.work_item_id is not null
      and wl.fecha between ${desde} and ${hasta}
    group by wl.work_item_id
  `;

  for (const t of trabajos) {
    invoices.push({
      tipo: "trabajo",
      work_item_id: t.work_item_id,
      referencia: `Trabajo ${t.work_item_id}`,
      importe: (Number(t.minutos) * Number(tarifaTrabajo?.precio || 0)) / 60,
    });
  }

  /* ========================
     4. Horas
  ======================== */

  const horas = await sql`
    select sum(wl.minutos) as minutos
    from work_logs_180 wl
    where wl.empresa_id=${empresaId}
      and wl.cliente_id=${clienteId}
      and wl.work_item_id is null
      and wl.fecha between ${desde} and ${hasta}
  `;

  const totalMin = Number(horas[0]?.minutos || 0);

  if (totalMin > 0 && tarifaHora) {
    invoices.push({
      tipo: "dia",
      work_item_id: null,
      referencia: `Horas ${desde} - ${hasta}`,
      importe: (totalMin / 60) * Number(tarifaHora.precio),
    });
  }

  return invoices;
}
export async function generarYGuardarInvoicesPeriodo({
  empresaId,
  clienteId,
  desde,
  hasta,
  userId = null,
}) {
  return await sql.begin(async (tx) => {
    /* ========================
       1. Anti-duplicado
    ======================== */

    const existe = await tx`
      select 1
      from invoices_180
      where empresa_id=${empresaId}
        and cliente_id=${clienteId}
        and fecha_emision between ${desde} and ${hasta}
        and estado <> 'cancelada'
      limit 1
    `;

    if (existe[0]) {
      const e = new Error("Ya existen facturas en ese periodo");
      e.status = 409;
      throw e;
    }

    /* ========================
       2. Generar borrador
    ======================== */

    const invoicesCalc = await generarInvoicesPeriodo({
      empresaId,
      clienteId,
      desde,
      hasta,
    });

    if (!invoicesCalc.length) {
      return {
        ok: true,
        creadas: 0,
        invoices: [],
      };
    }

    /* ========================
       3. Guardar
    ======================== */

    const creadas = [];

    for (const inv of invoicesCalc) {
      const r = await tx`
        insert into invoices_180 (
          empresa_id,
          cliente_id,
          tipo,
          work_item_id,
          referencia,
          importe_total,
          importe_pagado,
          saldo,
          estado,
          fecha_emision
        )
        values (
          ${empresaId},
          ${clienteId},
          ${inv.tipo},
          ${inv.work_item_id},
          ${inv.referencia},
          ${inv.importe},
          0,
          ${inv.importe},
          'pendiente',
          ${hasta}::date
        )
        returning *
      `;

      creadas.push(r[0]);
    }

    return {
      ok: true,
      creadas: creadas.length,
      invoices: creadas,
    };
  });
}
