// backend/src/services/planificacionResolver.js

import { sql } from "../db.js";

export async function resolverPlanDia({ empresaId, empleadoId, fecha }) {
  // fecha: 'YYYY-MM-DD'

  const asig = await sql`
    SELECT 
      a.plantilla_jornada_id AS plantilla_id,
      p.nombre AS plantilla_nombre,

      a.cliente_id,

      c.nombre AS cliente_nombre,
      c.lat,
      c.lng,
      c.radio_m,
      c.requiere_geo,
      c.geo_policy

    FROM asignaciones_plantilla_jornada_180 a

    JOIN plantillas_jornada_180 p
      ON p.id = a.plantilla_jornada_id

    LEFT JOIN clients_180 c
      ON c.id = a.cliente_id

    WHERE a.empleado_id = ${empleadoId}
      AND a.empresa_id = ${empresaId}
      AND a.activo = true
      AND p.activo = true
      AND a.fecha_inicio <= ${fecha}::date
      AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${fecha}::date)

    ORDER BY 
      a.activo DESC,
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

  const cliente = asig[0].cliente_id
    ? {
        id: asig[0].cliente_id,
        nombre: asig[0].cliente_nombre,
        lat: asig[0].lat,
        lng: asig[0].lng,
        radio_m: asig[0].radio_m,
        requiere_geo: asig[0].requiere_geo,
        geo_policy: asig[0].geo_policy,
      }
    : null;

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
      SELECT tipo, hora_inicio, hora_fin, obligatorio
      FROM plantilla_excepcion_bloques_180
      WHERE excepcion_id = ${exId}
      ORDER BY hora_inicio ASC
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
    SELECT tipo, hora_inicio, hora_fin, obligatorio
    FROM plantilla_bloques_180
    WHERE plantilla_dia_id = ${dia[0].id}
    ORDER BY hora_inicio ASC
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
    })),
  };
}
