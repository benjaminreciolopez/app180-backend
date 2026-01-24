// backend/src/services/jornadasService.js
import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";
import { getWorkContext } from "./workContextService.js";

function ymdFromDate(d, tz = "Europe/Madrid") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return fmt.format(new Date(d));
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
  clienteId,
  inicio,
  incidencia,
}) {
  const fecha = ymdFromDate(inicio);

  const contexto = await getWorkContext({
    empresaId,
    clienteId,
    fecha,
  });

  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha });

  const resumen = {
    version: 1,
    tz: "Europe/Madrid",

    fecha,

    plan, // snapshot planificación

    cliente: contexto.cliente,
    tarifas: contexto.tarifas,
    trabajos: contexto.trabajos,

    real: null,

    desviaciones: [],
    avisos: incidencia ? [incidencia] : [],

    margenes: {
      antes: 15,
      despues: 15,
    },
  };
  const abierta = await obtenerJornadaAbierta(empleadoId);

  if (abierta) {
    return abierta;
  }

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
      estado = 'completa',
      origen_cierre = ${origen_cierre},
      incidencia = COALESCE(${incidencia}, incidencia),
      updated_at = NOW()
    WHERE id = ${jornadaId}
      AND estado = 'abierta'
    RETURNING *
  `;
  return rows[0] || null;
}
