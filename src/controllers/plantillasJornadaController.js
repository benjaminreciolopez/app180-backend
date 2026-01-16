// backend/src/controllers/plantillasJornadaController.js

import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

async function getEmpresaIdAdmin(userId) {
  const r =
    await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  return r[0]?.id ?? null;
}

export const listarPlantillas = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const rows = await sql`
    select * from plantillas_jornada_180
    where empresa_id=${empresaId}
    order by created_at desc
  `;
  res.json(rows);
};

export const crearPlantilla = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { nombre, descripcion, tipo } = req.body;
  if (!nombre) return res.status(400).json({ error: "nombre obligatorio" });

  const r = await sql`
    insert into plantillas_jornada_180 (empresa_id, nombre, descripcion, tipo)
    values (${empresaId}, ${nombre}, ${descripcion ?? null}, ${
    tipo ?? "semanal"
  })
    returning *
  `;
  res.json(r[0]);
};

export const getPlantillaDetalle = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { id } = req.params;

  const p = await sql`
    select * from plantillas_jornada_180
    where id=${id} and empresa_id=${empresaId}
    limit 1
  `;
  if (!p.length) return res.status(404).json({ error: "No encontrada" });

  const dias = await sql`
    select * from plantilla_dias_180
    where plantilla_id=${id}
    order by dia_semana asc
  `;

  const excepciones = await sql`
    select * from plantilla_excepciones_180
    where plantilla_id=${id}
    order by fecha desc
  `;

  res.json({ plantilla: p[0], dias, excepciones });
};

export const actualizarPlantilla = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { id } = req.params;
  const { nombre, descripcion, tipo, activo } = req.body;

  const r = await sql`
    update plantillas_jornada_180
    set
      nombre = coalesce(${nombre}, nombre),
      descripcion = coalesce(${descripcion}, descripcion),
      tipo = coalesce(${tipo}, tipo),
      activo = coalesce(${activo}, activo)
    where id=${id} and empresa_id=${empresaId}
    returning *
  `;
  if (!r.length) return res.status(404).json({ error: "No encontrada" });
  res.json(r[0]);
};

export const borrarPlantilla = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { id } = req.params;

  await sql`delete from plantillas_jornada_180 where id=${id} and empresa_id=${empresaId}`;
  res.json({ ok: true });
};

export const upsertDiaSemana = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { id, dia_semana } = req.params;
  const { hora_inicio, hora_fin, activo } = req.body;

  // asegura que la plantilla es de la empresa
  const p =
    await sql`select 1 from plantillas_jornada_180 where id=${id} and empresa_id=${empresaId} limit 1`;
  if (!p.length)
    return res.status(404).json({ error: "Plantilla no encontrada" });

  const r = await sql`
    insert into plantilla_dias_180 (plantilla_id, dia_semana, hora_inicio, hora_fin, activo)
    values (${id}, ${Number(
    dia_semana
  )}, ${hora_inicio}, ${hora_fin}, coalesce(${activo}, true))
    on conflict (plantilla_id, dia_semana) do update set
      hora_inicio=excluded.hora_inicio,
      hora_fin=excluded.hora_fin,
      activo=excluded.activo
    returning *
  `;
  res.json(r[0]);
};

export const upsertBloquesDia = async (req, res) => {
  const { plantilla_dia_id } = req.params;
  const { bloques } = req.body; // [{tipo, hora_inicio, hora_fin, obligatorio}]
  if (!Array.isArray(bloques))
    return res.status(400).json({ error: "bloques debe ser array" });

  // estrategia simple: borrar y reinsertar
  await sql`delete from plantilla_bloques_180 where plantilla_dia_id=${plantilla_dia_id}`;
  for (const b of bloques) {
    await sql`
      insert into plantilla_bloques_180 (plantilla_dia_id, tipo, hora_inicio, hora_fin, obligatorio)
      values (${plantilla_dia_id}, ${b.tipo}, ${b.hora_inicio}, ${b.hora_fin}, coalesce(${b.obligatorio}, true))
    `;
  }
  const out = await sql`
    select * from plantilla_bloques_180
    where plantilla_dia_id=${plantilla_dia_id}
    order by hora_inicio asc
  `;
  res.json(out);
};

export const upsertExcepcionFecha = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { id, fecha } = req.params; // plantilla id, fecha YYYY-MM-DD
  const { hora_inicio, hora_fin, activo, nota } = req.body;

  const p =
    await sql`select 1 from plantillas_jornada_180 where id=${id} and empresa_id=${empresaId} limit 1`;
  if (!p.length)
    return res.status(404).json({ error: "Plantilla no encontrada" });

  const r = await sql`
    insert into plantilla_excepciones_180 (plantilla_id, fecha, hora_inicio, hora_fin, activo, nota)
    values (${id}, ${fecha}::date, ${hora_inicio ?? null}, ${
    hora_fin ?? null
  }, coalesce(${activo}, true), ${nota ?? null})
    on conflict (plantilla_id, fecha) do update set
      hora_inicio=excluded.hora_inicio,
      hora_fin=excluded.hora_fin,
      activo=excluded.activo,
      nota=excluded.nota
    returning *
  `;
  res.json(r[0]);
};

export const upsertBloquesExcepcion = async (req, res) => {
  const { excepcion_id } = req.params;
  const { bloques } = req.body;
  if (!Array.isArray(bloques))
    return res.status(400).json({ error: "bloques debe ser array" });

  await sql`delete from plantilla_excepcion_bloques_180 where excepcion_id=${excepcion_id}`;
  for (const b of bloques) {
    await sql`
      insert into plantilla_excepcion_bloques_180 (excepcion_id, tipo, hora_inicio, hora_fin, obligatorio)
      values (${excepcion_id}, ${b.tipo}, ${b.hora_inicio}, ${b.hora_fin}, coalesce(${b.obligatorio}, true))
    `;
  }
  const out = await sql`
    select * from plantilla_excepcion_bloques_180
    where excepcion_id=${excepcion_id}
    order by hora_inicio asc
  `;
  res.json(out);
};

export const asignarPlantillaEmpleado = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { empleado_id, plantilla_id, fecha_inicio, fecha_fin } = req.body;

  // valida empresa del empleado y plantilla
  const e =
    await sql`select 1 from employees_180 where id=${empleado_id} and empresa_id=${empresaId} limit 1`;
  const p =
    await sql`select 1 from plantillas_jornada_180 where id=${plantilla_id} and empresa_id=${empresaId} limit 1`;
  if (!e.length) return res.status(404).json({ error: "Empleado no válido" });
  if (!p.length) return res.status(404).json({ error: "Plantilla no válida" });

  const r = await sql`
    insert into empleado_plantillas_180 (empleado_id, plantilla_id, fecha_inicio, fecha_fin)
    values (${empleado_id}, ${plantilla_id}, ${fecha_inicio}::date, ${
    fecha_fin ?? null
  }::date)
    returning *
  `;
  res.json(r[0]);
};

export const listarAsignacionesEmpleado = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { empleado_id } = req.params;

  const rows = await sql`
    select ep.*, p.nombre as plantilla_nombre
    from empleado_plantillas_180 ep
    join plantillas_jornada_180 p on p.id = ep.plantilla_id
    join employees_180 e on e.id = ep.empleado_id
    where ep.empleado_id=${empleado_id}
      and e.empresa_id=${empresaId}
    order by ep.fecha_inicio desc
  `;
  res.json(rows);
};

export const getPlanDiaEmpleado = async (req, res) => {
  const empresaId = await getEmpresaIdAdmin(req.user.id);
  const { empleado_id } = req.params;
  const fecha =
    String(req.query.fecha || "").trim() ||
    new Date().toISOString().slice(0, 10);

  const e =
    await sql`select 1 from employees_180 where id=${empleado_id} and empresa_id=${empresaId} limit 1`;
  if (!e.length) return res.status(404).json({ error: "Empleado no válido" });

  const plan = await resolverPlanDia({
    empresaId,
    empleadoId: empleado_id,
    fecha,
  });
  res.json(plan);
};
