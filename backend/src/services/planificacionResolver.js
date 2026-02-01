// backend/src/services/planificacionResolver.js

import { sql } from "../db.js";

export async function resolverPlanDia({ empresaId, empleadoId, fecha }) {
  // fecha: 'YYYY-MM-DD'

  const asig = await sql`
    SELECT 
      a.plantilla_id AS plantilla_id,
      p.nombre AS plantilla_nombre,

      a.cliente_id,

      c.nombre AS cliente_nombre,
      c.lat,
      c.lng,
      c.radio_m,
      c.requiere_geo,
      c.geo_policy

    FROM empleado_plantillas_180 a

    JOIN plantillas_jornada_180 p
      ON p.id = a.plantilla_id

    LEFT JOIN clients_180 c
      ON c.id = a.cliente_id

    WHERE (${empleadoId}::uuid IS NULL OR a.empleado_id = ${empleadoId})
      AND a.empresa_id = ${empresaId}
      AND p.activo = true
      AND a.fecha_inicio <= ${fecha}::date
      AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${fecha}::date)

    ORDER BY 
      a.empleado_id NULLS FIRST,
      a.fecha_inicio DESC
    LIMIT 1
  `;
  if (asig.length > 1) {
    console.warn(
      "[resolverPlanDia] múltiples asignaciones activas:",
      asig.map((a) => a.id),
    );
  }

  if (!asig.length) {
    return {
      plantilla_id: null,
      plantilla_nombre: null,
      cliente: null,
      fecha,
      modo: "sin_plantilla",
      bloques: [],
    };
  }

  const plantillaId = asig[0].plantilla_id;
  const plantillaNombre = asig[0].plantilla_nombre;

  // 1. Cliente legacy (si viene en la asignación de plantilla)
  let clienteInfo = null;

  if (asig[0].cliente_id) {
    clienteInfo = {
      id: asig[0].cliente_id,
      nombre: asig[0].cliente_nombre,
      lat: asig[0].lat,
      lng: asig[0].lng,
      radio_m: asig[0].radio_m,
      requiere_geo: asig[0].requiere_geo,
      geo_policy: asig[0].geo_policy,
    };
  } else {
    // 2. Cliente desacoplado (tabla empleado_clientes_180)
    const cliRow = await sql`
      select c.id, c.nombre, c.lat, c.lng, c.radio_m, c.requiere_geo, c.geo_policy
      from empleado_clientes_180 ec
      join clients_180 c on c.id = ec.cliente_id
      where ec.empleado_id = ${empleadoId}
        and ec.empresa_id = ${empresaId}
        and ec.fecha_inicio <= ${fecha}::date
        and (ec.fecha_fin is null or ec.fecha_fin >= ${fecha}::date)
        and ec.activo = true
      order by ec.fecha_inicio desc
      limit 1
    `;

    if (cliRow.length && empleadoId) {
      clienteInfo = cliRow[0];
    }
  }

  const cliente = clienteInfo;

  /* =========================
     Excepción
  ========================= */

  const ex = await sql`
    SELECT id, hora_inicio, hora_fin, nota
    FROM plantilla_excepciones_180
    WHERE plantilla_id = ${plantillaId}
      AND fecha = ${fecha}::date
      AND activo = true
    LIMIT 1
  `;

  if (ex.length) {
    const exId = ex[0].id;

    const bloquesEx = await sql`
      SELECT b.tipo, b.hora_inicio, b.hora_fin, b.obligatorio, b.cliente_id,
             c.nombre AS cliente_nombre
      FROM plantilla_excepcion_bloques_180 b
      LEFT JOIN clients_180 c ON c.id = b.cliente_id
      WHERE b.excepcion_id = ${exId}
      ORDER BY b.hora_inicio ASC
    `;

    return {
      plantilla_id: plantillaId,
      plantilla_nombre: plantillaNombre,
      cliente,
      fecha,
      modo: "excepcion",

      rango:
        ex[0].hora_inicio && ex[0].hora_fin
          ? { inicio: ex[0].hora_inicio, fin: ex[0].hora_fin }
          : null,

      nota: ex[0].nota ?? null,

      bloques: bloquesEx.map((b) => ({
        tipo: b.tipo,
        inicio: b.hora_inicio,
        fin: b.hora_fin,
        obligatorio: b.obligatorio,
        cliente_id: b.cliente_id || cliente?.id || null,
        cliente_nombre: b.cliente_nombre || (b.cliente_id ? "Sede específica" : (cliente?.nombre || null)),
      })),
    };
  }

  /* =========================
     Día semana
  ========================= */

  function diaSemanaISO(fecha) {
    const iso = String(fecha).slice(0, 10);
    const [y, m, d] = iso.split("-").map(Number);

    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return null;
    }

    const dt = new Date(Date.UTC(y, m - 1, d));
    const js = dt.getUTCDay();

    return js === 0 ? 7 : js;
  }

  const diaSemana = diaSemanaISO(fecha);

  if (!Number.isFinite(diaSemana)) {
    return {
      plantilla_id: plantillaId,
      plantilla_nombre: plantillaNombre,
      cliente,
      fecha,
      modo: "semanal",
      rango: null,
      bloques: [],
    };
  }

  /* =========================
     Día plantilla
  ========================= */

  const dia = await sql`
    SELECT id, hora_inicio, hora_fin
    FROM plantilla_dias_180
    WHERE plantilla_id = ${plantillaId}
      AND dia_semana = ${diaSemana}
      AND activo = true
    LIMIT 1
  `;

  if (!dia.length) {
    return {
      plantilla_id: plantillaId,
      plantilla_nombre: plantillaNombre,
      cliente,
      fecha,
      modo: "semanal",
      rango: null,
      bloques: [],
    };
  }

  /* =========================
     Bloques
  ========================= */

  const bloques = await sql`
    SELECT b.tipo, b.hora_inicio, b.hora_fin, b.obligatorio, b.cliente_id,
           c.nombre AS cliente_nombre
    FROM plantilla_bloques_180 b
    LEFT JOIN clients_180 c ON c.id = b.cliente_id
    WHERE b.plantilla_dia_id = ${dia[0].id}
    ORDER BY b.hora_inicio ASC
  `;

  return {
    plantilla_id: plantillaId,
    plantilla_nombre: plantillaNombre,
    cliente,
    fecha,
    modo: "semanal",

    rango: {
      inicio: dia[0].hora_inicio,
      fin: dia[0].hora_fin,
    },

    bloques: bloques.map((b) => ({
      tipo: b.tipo,
      inicio: b.hora_inicio,
      fin: b.hora_fin,
      obligatorio: b.obligatorio,
      cliente_id: b.cliente_id || cliente?.id || null,
      cliente_nombre: b.cliente_nombre || (b.cliente_id ? "Sede específica" : (cliente?.nombre || null)),
    })),
  };
}
