import { sql } from "../db.js";

// Obtener jornada abierta del empleado
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

// Crear jornada
export async function crearJornada({ empresaId, empleadoId, inicio }) {
  const rows = await sql`
    INSERT INTO jornadas_180 (
      empresa_id,
      empleado_id,
      inicio,
      estado
    )
    VALUES (
      ${empresaId},
      ${empleadoId},
      ${inicio},
      'abierta'
    )
    RETURNING *
  `;
  return rows[0];
}

// Cerrar jornada
export async function cerrarJornada({
  jornadaId,
  fin,
  minutos_trabajados = 0,
  minutos_descanso = 0,
  minutos_extra = 0,
  origen_cierre = "app",
}) {
  const rows = await sql`
    UPDATE jornadas_180
    SET fin = ${fin},
        minutos_trabajados = ${minutos_trabajados},
        minutos_descanso = ${minutos_descanso},
        minutos_extra = ${minutos_extra},
        estado = 'cerrada',
        origen_cierre = ${origen_cierre}
    WHERE id = ${jornadaId}
    WHERE id = $1 AND estado = 'abierta'
    RETURNING *
  `;
  return rows[0];
}
