// backend/src/services/jornadasCalculo.js

import { sql } from "../db.js";

// ⏱️ minutos entre dos fechas
export function calcularMinutos(inicio, fin) {
  const diffMs = fin.getTime() - inicio.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

// ☕ minutos de descanso de una jornada
export async function calcularDescansoJornada(jornadaId) {
  const fichajes = await sql`
    SELECT tipo, fecha
    FROM fichajes_180
    WHERE jornada_id = ${jornadaId}
    AND tipo IN ('descanso_inicio', 'descanso_fin')
    ORDER BY fecha ASC
  `;

  let total = 0;
  let inicio = null;

  for (const f of fichajes) {
    if (f.tipo === "descanso_inicio") {
      inicio = new Date(f.fecha);
    }

    if (f.tipo === "descanso_fin" && inicio) {
      total += Math.floor((new Date(f.fecha) - inicio) / 60000);
      inicio = null;
    }
  }

  return total;
}
