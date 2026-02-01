import { sql } from "../db.js";

export async function obtenerTurnosEmpresa(empresa_id) {
  const rows = await sql`
    SELECT *
    FROM turnos_180
    WHERE empresa_id = ${empresa_id}
      AND activo = true
    ORDER BY nombre
  `;
  return rows;
}

export async function obtenerTurno(id) {
  const rows = await sql`
    SELECT *
    FROM turnos_180
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0];
}

export async function insertarTurno(data) {
  const rows = await sql`
    INSERT INTO turnos_180 (
      empresa_id, nombre, descripcion,
      tipo_turno, tipo_horario,
      horas_dia_objetivo,
      max_horas_dia, max_horas_semana,
      minutos_descanso_min, minutos_descanso_max,
      nocturno_permitido
    )
    VALUES (
      ${data.empresa_id},
      ${data.nombre},
      ${data.descripcion || null},
      ${data.tipo_turno},
      ${data.tipo_horario},
      ${data.horas_dia_objetivo || null},
      ${data.max_horas_dia || null},
      ${data.max_horas_semana || null},
      ${data.minutos_descanso_min || null},
      ${data.minutos_descanso_max || null},
      ${data.nocturno_permitido || false}
    )
    RETURNING *
  `;
  return rows[0];
}

export async function editarTurno(id, data) {
  const rows = await sql`
    UPDATE turnos_180
    SET nombre = ${data.nombre},
        descripcion = ${data.descripcion ?? null},
        tipo_turno = ${data.tipo_turno},
        tipo_horario = ${data.tipo_horario},
        horas_dia_objetivo = ${data.horas_dia_objetivo ?? null},
        max_horas_dia = ${data.max_horas_dia ?? null},
        max_horas_semana = ${data.max_horas_semana ?? null},
        minutos_descanso_min = ${data.minutos_descanso_min ?? null},
        minutos_descanso_max = ${data.minutos_descanso_max ?? null},
        nocturno_permitido = ${data.nocturno_permitido ?? false},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0];
}

export async function borrarTurno(id) {
  await sql`
    UPDATE turnos_180
    SET activo = false
    WHERE id = ${id}
  `;
}
// backend/src/services/turnosService.js
