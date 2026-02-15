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
  let empresaId = req.user.empresa_id;
  if (!empresaId) {
    empresaId = await getEmpresaId(req.user.id);
  }

  // Unimos con datos fiscales para que el frontend tenga la información completa al listar y editar
  const rows = await sql`
    select c.*,
           f.razon_social, f.nif_cif, f.tipo_fiscal,
           f.municipio, f.codigo_postal, f.direccion_fiscal,
           f.email_factura, f.telefono_factura, f.persona_contacto,
           f.iva_defecto, f.exento_iva, f.forma_pago, f.iban
    from clients_180 c
    left join client_fiscal_data_180 f on f.cliente_id = c.id
    where c.empresa_id = ${empresaId}
    order by c.activo desc, c.nombre
  `;

  res.json(rows);
}

/* ----------------------- */

/* ----------------------- */

export async function getClienteDetalle(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  // Hacemos JOIN con datos fiscales
  const r = await sql`
    select c.*,
           f.razon_social, f.nif_cif, f.tipo_fiscal,
           f.pais, f.provincia, f.municipio, f.codigo_postal, f.direccion_fiscal,
           f.email_factura, f.telefono_factura, f.persona_contacto,
           f.iva_defecto, f.exento_iva, f.forma_pago, f.iban
    from clients_180 c
    left join client_fiscal_data_180 f on f.cliente_id = c.id
    where c.id=${id}
      and c.empresa_id=${empresaId}
    limit 1
  `;

  if (!r[0]) return res.status(404).json({ error: "No existe" });

  res.json(r[0]);
}

async function obtenerSiguienteCodigoCliente(empresaId) {
  // Solo consultamos el número actual, NO incrementamos todavía.
  // El incremento real debe ocurrir al INSERTAR el cliente.
  const r = await sql`
    select last_num from cliente_seq_180
    where empresa_id = ${empresaId}
  `;

  const nextNum = r[0] ? r[0].last_num + 1 : 1;
  return `CLI-${String(nextNum).padStart(5, "0")}`;
}

export async function getNextCodigoCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const codigo = await obtenerSiguienteCodigoCliente(empresaId);
  res.json({ codigo });
}


/* ----------------------- */

export async function crearCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);

  const {
    nombre,
    codigo,
    tipo = "cliente",

    // Datos Generales
    direccion,
    telefono,
    contacto_nombre,
    contacto_email,

    // Datos Fiscales (Nuevos campos en tabla principal clients_180)
    nif,
    poblacion,
    municipio,
    provincia,
    cp,
    codigo_postal,
    pais = 'ES',
    email, // Email específico para facturación o duplicado del de contacto

    modo_defecto = "mixto",

    lat,
    lng,
    radio_m,
    requiere_geo = true,

    fecha_inicio,
    fecha_fin,

    notas,

    // Datos Fiscales Adicionales (Tabla satélite client_fiscal_data_180)
    razon_social,
    nif_cif, // Legacy o alternativo
    tipo_fiscal,
    direccion_fiscal,
    email_factura,
    telefono_factura,
    persona_contacto,
    iva_defecto,
    exento_iva,
    forma_pago,
    iban
  } = req.body;

  if (!nombre) return res.status(400).json({ error: "Nombre requerido" });

  /* =========================
     Saneamiento de País
  ========================= */
  let finalPais = (pais || "ES").trim().toUpperCase();
  if (finalPais === "ESPAÑA" || finalPais === "SPAIN" || finalPais === "ESP") {
    finalPais = "ES";
  }
  // Forzar máximo 2 caracteres para evitar el error character(2)
  if (finalPais.length > 2) {
    finalPais = finalPais.substring(0, 2);
  }

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

  try {
    const newClient = await sql.begin(async (tx) => {
      /* comprobar duplicado */
      const existe = await tx`
        select 1
        from clients_180
        where empresa_id=${empresaId}
          and codigo=${finalCodigo}
        limit 1
      `;

      if (existe[0]) {
        throw new Error("Código duplicado");
      }

      // 1. Insertar Cliente General (con campos sincronizados)
      const [cli] = await tx`
        insert into clients_180 (
          empresa_id, nombre, codigo, tipo,
          direccion, telefono, contacto_nombre, contacto_email,
          nif, nif_cif, poblacion, municipio, provincia, cp, codigo_postal, pais, email,
          modo_defecto, lat, lng, radio_m, requiere_geo, geo_policy,
          fecha_inicio, fecha_fin, notas,
          razon_social, iban, iva_defecto, exento_iva, activo
        )
        values (
          ${empresaId}, ${nombre}, ${finalCodigo}, ${tipo},
          ${n(direccion)}, ${n(telefono)}, ${n(contacto_nombre)}, ${n(contacto_email)},
          ${n(nif || nif_cif)}, ${n(nif_cif || nif)}, 
          ${n(poblacion || municipio)}, ${n(municipio || poblacion)}, 
          ${n(provincia)}, 
          ${n(cp || codigo_postal)}, ${n(codigo_postal || cp)},
          ${finalPais}, ${n(email)},
          ${modo_defecto},
          ${n(lat)}, ${n(lng)}, ${n(radio_m)}, ${requiere_geo}, 'info',
          ${n(fecha_inicio)}, ${n(fecha_fin)}, ${n(notas)},
          ${n(razon_social)}, ${n(iban)}, ${n(iva_defecto)}, ${exento_iva === true}, true
        )
        returning *
      `;

      // 2. Insertar Datos Fiscales
      await tx`
        insert into client_fiscal_data_180 (
          empresa_id, cliente_id, razon_social, nif_cif, tipo_fiscal,
          pais, provincia, municipio, codigo_postal, direccion_fiscal,
          email_factura, telefono_factura, persona_contacto,
          iva_defecto, exento_iva, forma_pago, iban
        ) values (
          ${empresaId},
          ${cli.id},
          ${n(razon_social)},
          ${n(nif_cif || nif)},
          ${n(tipo_fiscal)},
          ${finalPais},
          ${n(provincia)},
          ${n(municipio || poblacion)},
          ${n(codigo_postal || cp)},
          ${n(direccion_fiscal || direccion)},
          ${n(email_factura || email)},
          ${n(telefono_factura || telefono)},
          ${n(persona_contacto || contacto_nombre)},
          ${iva_defecto ? Number(iva_defecto) : null},
          ${exento_iva === true},
          ${n(forma_pago)},
          ${n(iban)}
        )
      `;

      // 3. Actualizar el contador de clientes si el código sigue el patrón CLI-XXXXX
      if (finalCodigo.startsWith("CLI-")) {
        const numPart = parseInt(finalCodigo.split("-")[1], 10);
        if (!isNaN(numPart)) {
          await tx`
            insert into cliente_seq_180 (empresa_id, last_num)
            values (${empresaId}, ${numPart})
            on conflict (empresa_id) do update
            set last_num = greatest(cliente_seq_180.last_num, ${numPart})
          `;
        }
      }

      return cli;
    });

    res.status(201).json({ ...newClient, razon_social, nif_cif });
  } catch (err) {
    console.error(err);
    return res.status(err.message === "Código duplicado" ? 400 : 500).json({
      error: err.message || "Error al crear cliente"
    });
  }
}

/* ----------------------- */

export async function actualizarCliente(req, res) {
  const empresaId = await getEmpresaId(req.user.id);
  const { id } = req.params;

  const body = req.body;

  // Campos de clients_180 (SYNC: algunos también van a client_fiscal_data_180)
  const allowedGeneral = [
    "nombre", "tipo", "direccion", "telefono", "contacto_nombre", "contacto_email",
    "modo_defecto", "lat", "lng", "radio_m", "requiere_geo", "fecha_inicio", "fecha_fin",
    "notas", "activo", "geo_policy",
    "nif", "nif_cif", "poblacion", "municipio", "provincia", "cp", "codigo_postal", "pais", "email",
    // Campos fiscales que también se guardan en clients_180 (sincronización)
    "razon_social", "iban", "iva_defecto", "exento_iva", "forma_pago"
  ];

  // Campos de client_fiscal_data_180
  const allowedFiscal = [
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

  const fieldsGeneral = {};
  const fieldsFiscal = {};

  for (const k of Object.keys(body)) {
    let val = body[k] === undefined ? null : body[k];

    // Sanear país si viene en el body
    if (k === "pais" && typeof val === "string") {
      val = val.trim().toUpperCase();
      if (val === "ESPAÑA" || val === "SPAIN" || val === "ESP") val = "ES";
      if (val.length > 2) val = val.substring(0, 2);
    }

    // Agregar a fieldsGeneral si está en allowedGeneral
    if (allowedGeneral.includes(k)) fieldsGeneral[k] = val;
    
    // Agregar a fieldsFiscal si está en allowedFiscal
    if (allowedFiscal.includes(k)) fieldsFiscal[k] = val;
    
    // SYNC: Si es un campo fiscal, también agregarlo a fieldsGeneral para sincronizar clients_180
    const fiscalOnlyFields = ["razon_social", "nif_cif", "tipo_fiscal", "direccion_fiscal", "email_factura", "telefono_factura", "persona_contacto", "codigo_postal"];
    if (fiscalOnlyFields.includes(k) && !fieldsFiscal[k]) {
      // Solo agregar a fieldsFiscal si no está ya
      fieldsFiscal[k] = val;
    }
  }

  // Actualizar tabla general
  let clientUpdated = null;
  if (Object.keys(fieldsGeneral).length > 0) {
    const r = await sql`
      update clients_180
      set ${sql(fieldsGeneral)}
      where id=${id}
        and empresa_id=${empresaId}
      returning *
    `;
    clientUpdated = r[0];
  }

  // Actualizar tabla fiscal (upsert por si no existía)
  if (Object.keys(fieldsFiscal).length > 0) {
    // Check if exists
    const exists = await sql`select id from client_fiscal_data_180 where cliente_id=${id}`;

    // Aseguramos que no haya propiedades undefined (doble check)
    for (const key in fieldsFiscal) {
      if (fieldsFiscal[key] === undefined) fieldsFiscal[key] = null;
    }

    console.log(`[actualizarCliente] fieldsFiscal:`, fieldsFiscal, `exists: ${exists[0] ? 'sí' : 'no'}`);

    if (exists[0]) {
      console.log(`[actualizarCliente] UPDATE client_fiscal_data_180 para cliente ${id}`);
      await sql`
        update client_fiscal_data_180
        set ${sql(fieldsFiscal)}
        where cliente_id=${id}
      `;
    } else {
      // Create if missing
      await sql`
        insert into client_fiscal_data_180 (
          empresa_id,
          cliente_id,
          razon_social,
          nif_cif,
          tipo_fiscal,
          pais,
          provincia,
          municipio,
          codigo_postal,
          direccion_fiscal,
          email_factura,
          telefono_factura,
          persona_contacto,
          iva_defecto,
          exento_iva,
          forma_pago,
          iban
        ) values (
          ${empresaId},
          ${id},
          ${fieldsFiscal.razon_social ?? null},
          ${fieldsFiscal.nif_cif ?? null},
          ${fieldsFiscal.tipo_fiscal ?? null},
          ${fieldsFiscal.pais ?? 'ES'},
          ${fieldsFiscal.provincia ?? null},
          ${fieldsFiscal.municipio ?? null},
          ${fieldsFiscal.codigo_postal ?? null},
          ${fieldsFiscal.direccion_fiscal ?? null},
          ${fieldsFiscal.email_factura ?? null},
          ${fieldsFiscal.telefono_factura ?? null},
          ${fieldsFiscal.persona_contacto ?? null},
          ${fieldsFiscal.iva_defecto ?? null},
          ${fieldsFiscal.exento_iva ?? false},
          ${fieldsFiscal.forma_pago ?? null},
          ${fieldsFiscal.iban ?? null}
        )
      `;
    }
  }

  // Respuesta final
  if (clientUpdated) {
    res.json(clientUpdated);
  } else {
    // Si solo actualizamos fiscal, devolvemos success genérico o fetch del cliente
    res.json({ ok: true, id });
  }
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

/* =========================
   Asignación de Clientes (Desacoplado)
========================= */

export async function asignarClienteEmpleado(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { empleado_id, cliente_id, fecha_inicio, fecha_fin } = req.body || {};

    if (!empleado_id || !cliente_id || !fecha_inicio) {
      return res.status(400).json({
        error: "empleado_id, cliente_id y fecha_inicio son obligatorios",
      });
    }

    const out = await sql.begin(async (tx) => {
      // 1. Validar entidades
      const [emp] = await tx`
        select 1 from employees_180 
        where id=${empleado_id} and empresa_id=${empresaId}
      `;
      if (!emp) throw new Error("Empleado inválido");

      const [cli] = await tx`
        select 1 from clients_180 
        where id=${cliente_id} and empresa_id=${empresaId}
      `;
      if (!cli) throw new Error("Cliente inválido");

      // 2. Cerrar asignación anterior activa si solapa (o fecha_fin es null)
      //    Lógica simple: Si la nueva empieza en F, cerramos la anterior en F - 1 día
      const inicioDate = new Date(fecha_inicio);
      const ayer = new Date(inicioDate);
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = ayer.toISOString().slice(0, 10);

      await tx`
        update empleado_clientes_180
        set fecha_fin = ${ayerStr}::date
        where empleado_id=${empleado_id}
          and empresa_id=${empresaId}
          and activo=true
          and (fecha_fin is null or fecha_fin >= ${fecha_inicio}::date)
      `;

      // 3. Insertar nueva
      const [nueva] = await tx`
        insert into empleado_clientes_180 (
          empresa_id, empleado_id, cliente_id, fecha_inicio, fecha_fin
        ) values (
          ${empresaId},
          ${empleado_id},
          ${cliente_id},
          ${fecha_inicio}::date,
          ${n(fecha_fin)}::date
        )
        returning *
      `;
      return nueva;
    });

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al asignar cliente" });
  }
}

export async function listarAsignacionesClientes(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { empleado_id } = req.params;

    const rows = await sql`
      select ec.*, c.nombre as cliente_nombre
      from empleado_clientes_180 ec
      join clients_180 c on c.id = ec.cliente_id
      where ec.empleado_id=${empleado_id}
        and ec.empresa_id=${empresaId}
      order by ec.fecha_inicio desc
    `;

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error listando clientes" });
  }
}

export async function desasignarClienteEmpleado(req, res) {
  try {
    const empresaId = await getEmpresaId(req.user.id);
    const { empleado_id } = req.body || {};

    if (!empleado_id) {
      return res.status(400).json({ error: "empleado_id es obligatorio" });
    }

    await sql.begin(async (tx) => {
      // Validar empleado
      const e = await tx`
        select 1
        from employees_180
        where id=${empleado_id} and empresa_id=${empresaId}
        limit 1
      `;
      if (!e.length) {
        return res.status(404).json({ error: "Empleado no válido" });
      }

      // Fecha HOY desde Postgres
      const [{ hoy }] = await tx`select current_date as hoy`;

      // Cerrar TODAS las asignaciones de cliente abiertas
      await tx`
        update empleado_clientes_180
        set fecha_fin = greatest(fecha_inicio, ${hoy}::date - interval '1 day'),
            activo = false
        where empleado_id = ${empleado_id}
          and empresa_id = ${empresaId}
          and fecha_fin is null
      `;
    });

    res.json({ ok: true, message: "Asignaciones de cliente cerradas correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error desasignando cliente" });
  }
}

