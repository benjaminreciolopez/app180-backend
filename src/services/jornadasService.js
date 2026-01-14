// backend/src/services/jornadasService.js
import { sql } from "../db.js";

function toYMD(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  incidencia = null,
  origen_creacion = "app",
}) {
  const fecha = toYMD(inicio);

  const rows = await sql`
    INSERT INTO jornadas_180 (
      empresa_id,
      empleado_id,
      fecha,
      inicio,
      hora_entrada,
      estado,
      incidencia,
      origen_creacion
    )
    VALUES (
      ${empresaId},
      ${empleadoId},
      ${fecha},
      ${inicio},
      ${inicio},
      'abierta',
      ${incidencia},
      ${origen_creacion}
    )
    RETURNING *
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
