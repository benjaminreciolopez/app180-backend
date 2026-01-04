import { sql } from "../db.js";

/**
 * Obtiene el turno asignado a un empleado con los datos mínimos
 * necesarios para validar un fichaje.
 */
export async function obtenerTurnoEmpleado({ empleadoId, empresaId }) {
  const rows = await sql`
    SELECT
      e.id AS empleado_id,
      e.turno_id,
      e.max_duracion_turno,
      t.nocturno_permitido,
      t.max_horas_dia,
      t.max_horas_semana,
      t.horas_dia_objetivo
    FROM employees_180 e
    LEFT JOIN turnos_180 t ON t.id = e.turno_id
    WHERE e.id = ${empleadoId}
      AND e.empresa_id = ${empresaId}
    LIMIT 1
  `;

  return rows[0] || null;
}
