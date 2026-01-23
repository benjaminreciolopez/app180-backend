import { sql } from "../db.js";
import { calcularMinutos } from "../services/jornadasCalculo.js";

// Helpers
function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 0);
  return d;
}

export const ejecutarAutocierre = async () => {
  try {
    const ahora = new Date();
    const hoyYMD = ahora.toISOString().slice(0, 10);

    const jornadas = await sql`
      SELECT 
        j.*,
        COALESCE(e.max_duracion_turno, 14) AS max_horas,
        e.user_id AS empleado_user_id,
        t.nocturno_permitido,
        t.hora_fin
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      LEFT JOIN turnos_180 t ON t.id = e.turno_id
      WHERE j.estado = 'abierta'
        AND j.inicio IS NOT NULL
    `;

    if (!jornadas.length) return;

    for (const j of jornadas) {
      const inicio = new Date(j.inicio);
      const inicioYMD = inicio.toISOString().slice(0, 10);

      let fin = null;
      let motivo = null;
      let origen = null;

      /* ======================
         1️⃣ Cambio de día
      ====================== */

      if (inicioYMD < hoyYMD) {
        // Turno nocturno
        if (j.nocturno_permitido && j.hora_fin) {
          const finNocturno = new Date(
            `${hoyYMD}T${String(j.hora_fin).slice(0, 5)}:00`,
          );

          if (ahora >= finNocturno) {
            fin = finNocturno;
            motivo = "fin_turno_nocturno";
            origen = "automatico";
          }
        } else {
          fin = endOfDay(inicio);
          motivo = "fin_dia";
          origen = "automatico";
        }
      }

      /* ======================
         2️⃣ Exceso de horas
      ====================== */

      if (!fin) {
        const maxHoras = Number(j.max_horas || 14);
        const finMax = addHours(inicio, maxHoras);

        if (ahora >= finMax) {
          fin = finMax;
          motivo = "exceso_duracion";
          origen = "autocierre_seguridad";
        }
      }

      if (!fin) continue;

      const minutos = calcularMinutos(inicio, fin);

      /* ======================
         CIERRE
      ====================== */

      await sql`
        UPDATE jornadas_180
        SET
          fin = ${fin},
          hora_salida = ${fin},
          minutos_trabajados = ${minutos},
          estado = 'incompleta',
          origen_cierre = ${origen},
          incidencia = concat_ws(
            ' | ',
            NULLIF(incidencia, ''),
            ${"Autocierre: " + motivo}
          ),
          updated_at = NOW()
        WHERE id = ${j.id}
          AND estado = 'abierta'
      `;

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
          ${origen},
          ${"Salida automática por " + motivo},
          false,
          false
        )
      `;
    }
  } catch (err) {
    console.error("❌ Error ejecutando autocierre:", err);
  }
};
// backend/src/controllers/workLogsController.js
