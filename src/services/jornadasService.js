// backend/src/services/jornadasService.js
import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";

function ymdFromDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Obtener jornada abierta del empleado (NO filtrar por fecha, por nocturnos)
export async function obtenerJornadaAbierta(empleadoId) {
  const rows = await sql`
    SELECT *
    FROM jornadas_180
    WHERE empleado_id = ${empleadoId}
      AND estado = 'abierta'
    ORDER BY inicio DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

// Crear jornada (fecha = día de INICIO)
export async function crearJornada({
  empresaId,
  empleadoId,
  inicio,
  incidencia,
}) {
  const fecha = ymdFromDate(inicio);

  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha });

  const resumen = {
    fecha,
    plan, // snapshot
    real: null, // lo rellena jornadaEngine
    desviaciones: [],
    avisos: incidencia ? [incidencia] : [],
  };

  const rows = await sql`
    insert into jornadas_180 (
      empresa_id,
      empleado_id,
      fecha,
      inicio,
      estado,
      incidencia,
      origen_creacion,
      plantilla_id,
      resumen_json
    )
    values (
      ${empresaId},
      ${empleadoId},
      ${fecha}::date,
      ${inicio},
      'abierta',
      ${incidencia || null},
      'app',
      ${plan.plantilla_id || null},
      ${resumen}
    )
    returning *
  `;

  return rows[0];
}
// Cerrar jornada (SQL correcto + rellena fin y hora_salida)
export async function cerrarJornada({
  jornadaId,
  fin,
  minutos_trabajados = 0,
  minutos_descanso = 0,
  minutos_extra = 0,
  origen_cierre = "app",
  incidencia = null,
}) {
  const rows = await sql`
    UPDATE jornadas_180
    SET
      fin = ${fin},
      hora_salida = ${fin},
      minutos_trabajados = ${minutos_trabajados},
      minutos_descanso = ${minutos_descanso},
      minutos_extra = ${minutos_extra},
      estado = 'cerrada',
      origen_cierre = ${origen_cierre},
      incidencia = COALESCE(${incidencia}, incidencia),
      updated_at = NOW()
    WHERE id = ${jornadaId}
      AND estado = 'abierta'
    RETURNING *
  `;
  return rows[0] || null;
}
