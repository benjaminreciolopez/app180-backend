import { sql } from "../db.js";

/* =========================
   Helpers
========================= */

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

function validarModoPrecio(modo, body) {
  switch (modo) {
    case "hora":
      if (body.precio_hora == null) throw new Error("precio_hora requerido");
      break;
    case "dia":
      if (body.precio_dia == null) throw new Error("precio_dia requerido");
      break;
    case "mes":
      if (body.precio_mes == null) throw new Error("precio_mes requerido");
      break;
    case "precio_fijo":
      if (body.precio_trabajo == null)
        throw new Error("precio_trabajo requerido");
      break;
  }
}

/* =========================
   CRUD
========================= */

export async function listarClientes(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const rows = await sql`
    select *
    from clients_180
    where empresa_id = ${empresaId}
    order by activo desc, nombre
  `;

  res.json(rows);
}

/* ----------------------- */

export async function getClienteDetalle(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const r = await sql`
    select *
    from clients_180
    where id=${id}
      and empresa_id=${empresaId}
    limit 1
  `;

  if (!r[0]) return res.status(404).json({ error: "No existe" });

  res.json(r[0]);
}

/* ----------------------- */

export async function crearCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const {
    nombre,
    codigo,
    tipo = "cliente",
    direccion,
    telefono,
    contacto_nombre,
    contacto_email,

    modo_trabajo,

    precio_hora,
    precio_dia,
    precio_mes,
    precio_trabajo,

    lat,
    lng,
    radio_m,
    requiere_geo = true,

    fecha_inicio,
    fecha_fin,

    notas,
  } = req.body;

  if (!nombre || !modo_trabajo)
    return res.status(400).json({ error: "Datos incompletos" });

  validarModoPrecio(modo_trabajo, req.body);

  const r = await sql`
    insert into clients_180 (
      empresa_id,
      nombre,
      codigo,
      tipo,

      direccion,
      telefono,
      contacto_nombre,
      contacto_email,

      modo_trabajo,
      precio_hora,
      precio_dia,
      precio_mes,
      precio_trabajo,

      lat,lng,radio_m,requiere_geo,

      fecha_inicio,fecha_fin,

      notas
    )
    values (
      ${empresaId},
      ${nombre},
      ${codigo},
      ${tipo},

      ${direccion},
      ${telefono},
      ${contacto_nombre},
      ${contacto_email},

      ${modo_trabajo},
      ${precio_hora},
      ${precio_dia},
      ${precio_mes},
      ${precio_trabajo},

      ${lat},${lng},${radio_m},${requiere_geo},

      ${fecha_inicio},${fecha_fin},

      ${notas}
    )
    returning *
  `;

  res.status(201).json(r[0]);
}

/* ----------------------- */

export async function actualizarCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const fields = req.body;

  const r = await sql`
    update clients_180
    set ${sql(fields)}
    where id=${id}
      and empresa_id=${empresaId}
    returning *
  `;

  if (!r[0]) return res.status(404).json({ error: "No encontrado" });

  res.json(r[0]);
}

/* ----------------------- */

export async function desactivarCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  await sql`
    update clients_180
    set activo=false
    where id=${id}
      and empresa_id=${empresaId}
  `;

  res.json({ ok: true });
}

/* =========================
   Utilidad: histórico
========================= */

export async function crearClienteHistorico(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const existe = await sql`
    select id
    from clients_180
    where empresa_id=${empresaId}
      and tipo='interno'
      and nombre='HISTÓRICO SIN CLIENTE'
    limit 1
  `;

  if (existe[0]) return res.json(existe[0]);

  const r = await sql`
    insert into clients_180 (
      empresa_id,
      nombre,
      tipo,
      activo,
      notas
    )
    values (
      ${empresaId},
      'HISTÓRICO SIN CLIENTE',
      'interno',
      false,
      'Cliente automático para datos anteriores'
    )
    returning id
  `;

  res.json(r[0]);
}
