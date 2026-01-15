// backend/src/jobs/autocierre.js
import { sql } from "../db.js";
import { calcularMinutos } from "../services/jornadasCalculo.js";

// Helper: suma horas a una fecha
function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

export const ejecutarAutocierre = async () => {
  try {
    const ahora = new Date();

    const jornadasAbiertas = await sql`
      SELECT 
        j.*,
        COALESCE(e.max_duracion_turno, 14) AS max_horas,
        e.user_id AS empleado_user_id
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.estado = 'abierta'
        AND j.inicio IS NOT NULL
    `;

    if (jornadasAbiertas.length === 0) return;

    for (const j of jornadasAbiertas) {
      const inicio = new Date(j.inicio);
      const maxHoras = Number(j.max_horas || 14);
      const finMax = addHours(inicio, maxHoras);

      // Si aún no supera maxHoras, no cerrar
      if (ahora < finMax) continue;

      // fin_autocierre: inicio + maxHoras (regla segura)
      const fin = finMax;
      const minutos = calcularMinutos(inicio, fin);

      // Cierra jornada (con fin + hora_salida)
      await sql`
        UPDATE jornadas_180
        SET
          fin = ${fin},
          hora_salida = ${fin},
          minutos_trabajados = ${minutos},
          estado = 'incompleta',
          origen_cierre = 'autocierre_seguridad',
          incidencia = COALESCE(incidencia, '') || CASE 
            WHEN incidencia IS NULL OR incidencia = '' THEN 'Cierre automático por exceso de duración'
            ELSE ' | Cierre automático por exceso de duración'
          END,
          updated_at = NOW()
        WHERE id = ${j.id}
          AND estado = 'abierta'
      `;

      // Inserta fichaje "salida" automático (trazabilidad)
      await sql`
        INSERT INTO fichajes_180 (
          user_id,
          empleado_id,
          empresa_id,
          jornada_id,
          tipo,
          fecha,
          estado,
          origen,
          nota,
          sospechoso,
          creado_manual
        )
        VALUES (
          ${j.empleado_user_id},
          ${j.empleado_id},
          ${j.empresa_id},
          ${j.id},
          'salida',
          ${fin},
          'confirmado',
          'autocierre',
          'Autocierre: salida generada automáticamente por falta de fichaje',
          false,
          false
        )
      `;
    }
  } catch (err) {
    console.error("❌ Error ejecutando autocierre:", err);
  }
};
