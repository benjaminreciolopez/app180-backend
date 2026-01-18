// backend/src/services/planificacionResolver.js

import { sql } from "../db.js";

export async function resolverPlanDia({ empresaId, empleadoId, fecha }) {
  // fecha: 'YYYY-MM-DD'

  // 1) plantilla activa del empleado para esa fecha
  const asig = await sql`
    SELECT ep.plantilla_id
    FROM empleado_plantillas_180 ep
    JOIN plantillas_jornada_180 p ON p.id = ep.plantilla_id
    WHERE ep.empleado_id = ${empleadoId}
      AND p.empresa_id = ${empresaId}
      AND p.activo = true
      AND ep.fecha_inicio <= ${fecha}::date
      AND (ep.fecha_fin is null OR ep.fecha_fin >= ${fecha}::date)
    ORDER BY ep.fecha_inicio DESC
    LIMIT 1
  `;

  if (!asig.length) {
    return {
      plantilla_id: null,
      fecha,
      modo: "sin_plantilla",
      bloques: [],
    };
  }

  const plantillaId = asig[0].plantilla_id;

  // 2) excepción del día (si existe)
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

  function diaSemanaISO(fecha) {
    const iso = String(fecha).slice(0, 10); // admite YYYY-MM-DD o ISO completo
    const [y, m, d] = iso.split("-").map(Number);

    if (
      !Number.isFinite(y) ||
      !Number.isFinite(m) ||
      !Number.isFinite(d) ||
      m < 1 ||
      m > 12 ||
      d < 1 ||
      d > 31
    ) {
      return null;
    }

    const dt = new Date(Date.UTC(y, m - 1, d));
    const js = dt.getUTCDay(); // 0..6
    return js === 0 ? 7 : js; // 1..7
  }

  const diaSemana = diaSemanaISO(fecha);
  if (!Number.isFinite(diaSemana)) {
    console.error("[resolverPlanDia] fecha invalida:", fecha);
    return {
      plantilla_id: plantillaId,
      fecha,
      modo: "semanal",
      rango: null,
      bloques: [],
    };
  }

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
      fecha,
      modo: "semanal",
      rango: null,
      bloques: [],
    };
  }

  const bloques = await sql`
    SELECT tipo, hora_inicio, hora_fin, obligatorio
    FROM plantilla_bloques_180
    WHERE plantilla_dia_id = ${dia[0].id}
    ORDER BY hora_inicio ASC
  `;

  return {
    plantilla_id: plantillaId,
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
