// backend/src/controllers/clientesController.js

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
function n(v) {
  return v === undefined ? null : v;
}

/* =========================
   CRUD
========================= */

export async function listarClientes(req, res) {
  // Si viene con req.user.empresa_id (middleware auth), lo usamos
  let empresaId = req.user.empresa_id;

  // Si no está (caso raro o admin sin contexto), intentamos buscarlo
  if (!empresaId) {
    empresaId = await getEmpresaId(req.user.id);
  }

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
async function generarCodigoCliente(empresaId) {
  // Intentar incrementar
  let r = await sql`
    update cliente_seq_180
    set last_num = last_num + 1
    where empresa_id = ${empresaId}
    returning last_num
  `;

  // Si no existe fila → crearla
  if (!r[0]) {
    const init = await sql`
      insert into cliente_seq_180 (empresa_id, last_num)
      values (${empresaId}, 1)
      returning last_num
    `;

    return `CLI-${String(init[0].last_num).padStart(5, "0")}`;
  }

  // Caso normal
  return `CLI-${String(r[0].last_num).padStart(5, "0")}`;
}

export async function getNextCodigoCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const codigo = await generarCodigoCliente(empresaId);

  res.json({ codigo });
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

    modo_defecto = "mixto",

    lat,
    lng,
    radio_m,
    requiere_geo = true,

    fecha_inicio,
    fecha_fin,

    notas,
  } = req.body;

  if (!nombre) return res.status(400).json({ error: "Nombre requerido" });

  const modosValidos = ["hora", "dia", "mes", "trabajo", "mixto"];

  if (!modosValidos.includes(modo_defecto)) {
    return res.status(400).json({ error: "Modo inválido" });
  }

  if (radio_m != null && Number(radio_m) <= 0) {
    return res.status(400).json({ error: "Radio inválido" });
  }

  if (lat != null && (Number(lat) < -90 || Number(lat) > 90)) {
    return res.status(400).json({ error: "Lat inválida" });
  }

  if (lng != null && (Number(lng) < -180 || Number(lng) > 180)) {
    return res.status(400).json({ error: "Lng inválida" });
  }

  /* =========================
   Código obligatorio
========================= */

  if (!codigo) {
    return res.status(400).json({ error: "Código requerido" });
  }

  const finalCodigo = codigo;

  /* comprobar duplicado */
  const existe = await sql`
  select 1
  from clients_180
  where empresa_id=${empresaId}
    and codigo=${finalCodigo}
  limit 1
`;

  if (existe[0]) {
    return res.status(400).json({ error: "Código duplicado" });
  }

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

      modo_defecto,

      lat,
      lng,
      radio_m,
      requiere_geo,

      fecha_inicio,
      fecha_fin,

      notas
    )
    values (
      ${empresaId},
      ${nombre},
      ${finalCodigo},
      ${tipo},

      ${n(direccion)},
      ${n(telefono)},
      ${n(contacto_nombre)},
      ${n(contacto_email)},

      ${modo_defecto},

      ${n(lat)},
      ${n(lng)},
      ${n(radio_m)},
      ${requiere_geo},

      ${n(fecha_inicio)},
      ${n(fecha_fin)},

      ${n(notas)}
    )
    returning *
  `;

  res.status(201).json(r[0]);
}

/* ----------------------- */

export async function actualizarCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const body = req.body;

  const allowed = [
    "nombre",
    "tipo",

    "direccion",
    "telefono",
    "contacto_nombre",
    "contacto_email",

    "modo_defecto",

    "lat",
    "lng",
    "radio_m",
    "requiere_geo",

    "fecha_inicio",
    "fecha_fin",

    "notas",
    "activo",
    "geo_policy",

    // fiscal
    "razon_social",
    "nif_cif",
    "tipo_fiscal",
    "pais",
    "provincia",
    "codigo_postal",
    "direccion_fiscal",
    "municipio",
    "email_factura",
    "telefono_factura",
    "persona_contacto",
    "iva_defecto",
    "exento_iva",
    "forma_pago",
    "iban",
  ];

  const fields = {};

  for (const k of allowed) {
    if (k in body) fields[k] = body[k];
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "Sin campos válidos" });
  }

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
