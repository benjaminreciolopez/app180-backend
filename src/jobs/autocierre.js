import { sql } from "../db.js";
import { calcularMinutos } from "../services/jornadasCalculo.js";

export const ejecutarAutocierre = async () => {
  try {
    console.log("⏳ Ejecutando autocierre de jornadas abiertas...");

    const ahora = new Date();

    const jornadasAbiertas = await sql`
      SELECT 
        j.*,
        COALESCE(e.max_duracion_turno, 14) AS max_horas
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.estado = 'abierta'
    `;

    if (jornadasAbiertas.length === 0) {
      console.log("✔ No hay jornadas abiertas");
      return;
    }

    for (const j of jornadasAbiertas) {
      const inicio = new Date(j.hora_entrada || j.created_at);
      const maxHoras = j.max_horas;
      const horasAbierta = (ahora - inicio) / 36e5;

      if (horasAbierta < maxHoras) continue;

      const fin = new Date(inicio);
      fin.setHours(fin.getHours() + maxHoras);

      const minutos = calcularMinutos(inicio, fin);

      await sql`
        UPDATE jornadas_180
        SET
          hora_salida = ${fin},
          minutos_trabajados = ${minutos},
          estado = 'cerrada',
          origen_cierre = 'autocierre',
          incidencia = 'Cierre automático por exceso de duración',
          updated_at = NOW()
        WHERE id = ${j.id}
      `;

      console.log(`✔ Jornada autocerrada (${j.id})`);
    }

    console.log("✔ Autocierre completado");
  } catch (err) {
    console.error("❌ Error ejecutando autocierre:", err);
  }
};
export function calcularMinutos(inicio, fin) {
  const diffMs = fin.getTime() - inicio.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}
