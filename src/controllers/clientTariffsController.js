// backend/src/controllers/clientTariffsController.js

import { sql } from "../db.js";

async function getEmpresaId(userId) {
  const r =
    await sql`select id from empresa_180 where user_id=${userId} limit 1`;

  if (!r[0]) throw new Error("Empresa no asociada");

  return r[0].id;
}

/* ===================== */

export async function listarTarifasCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const rows = await sql`
    select *
    from client_tariffs_180
    where empresa_id=${empresaId}
      and cliente_id=${id}
      and activo=true
    order by fecha_inicio desc
  `;

  res.json(rows);
}

/* ===================== */

export async function crearTarifaCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const { tipo, work_item_id, precio, fecha_inicio, fecha_fin } = req.body;

  const tiposValidos = ["hora", "dia", "mes", "trabajo"];

  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ error: "Tipo inválido" });
  }

  if (Number(precio) < 0) {
    return res.status(400).json({ error: "Precio inválido" });
  }

  if (fecha_fin && fecha_fin < fecha_inicio) {
    return res.status(400).json({ error: "Rango de fechas inválido" });
  }

  // Verificar cliente pertenece a empresa
  const existe = await sql`
    select 1
    from clients_180
    where id=${id}
      and empresa_id=${empresaId}
  `;

  if (!existe[0]) {
    return res.status(404).json({ error: "Cliente no existe" });
  }

  try {
    const r = await sql`
      insert into client_tariffs_180 (
        empresa_id,
        cliente_id,
        tipo,
        work_item_id,
        precio,
        fecha_inicio,
        fecha_fin
      )
      values (
        ${empresaId},
        ${id},
        ${tipo},
        ${work_item_id ?? null},
        ${precio},
        ${fecha_inicio},
        ${fecha_fin ?? null}
      )
      returning *
    `;

    res.status(201).json(r[0]);
  } catch (e) {
    if (e.code === "23P01") {
      return res.status(409).json({
        error: "Ya existe tarifa activa en ese periodo",
      });
    }

    throw e;
  }
}

/* ===================== */

export async function cerrarTarifa(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { tarifaId } = req.params;

  await sql`
    update client_tariffs_180
    set activo=false,
        fecha_fin = current_date
    where id=${tarifaId}
      and empresa_id=${empresaId}
  `;

  res.json({ ok: true });
}
export async function getTarifaActiva(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;
  const { tipo, work_item_id } = req.query;

  if (!tipo) return res.status(400).json({ error: "Tipo requerido" });

  const r = await sql`
    select *
    from client_tariffs_180
    where empresa_id=${empresaId}
      and cliente_id=${id}
      and tipo=${tipo}
      and activo=true
      and fecha_inicio <= current_date
      and (fecha_fin is null or fecha_fin >= current_date)
      and (
        (${work_item_id}::uuid is null and work_item_id is null)
        or work_item_id = ${work_item_id}
      )
    order by
      (work_item_id is not null) desc,
      fecha_inicio desc
    limit 1
  `;

  if (!r[0]) return res.status(404).json({ error: "Sin tarifa activa" });

  res.json(r[0]);
}
