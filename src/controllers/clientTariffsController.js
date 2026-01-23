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

  if (!tipo || !precio || !fecha_inicio)
    return res.status(400).json({ error: "Datos incompletos" });

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
