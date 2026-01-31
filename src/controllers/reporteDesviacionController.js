// backend/src/controllers/reporteDesviacionController.js

import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

function diffMinutes(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return (e - s) / 1000 / 60;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export const getReporteDesviaciones = async (req, res) => {
  try {
    const { desde, hasta, empleado_id } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: "Fechas requeridas" });

    // 1. Obtener jornadas reales en el rango
    const jornadas = await sql`
      SELECT j.id, j.empleado_id, e.nombre, j.fecha, j.inicio, j.fin, j.minutos_trabajados
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.fecha BETWEEN ${desde} AND ${hasta}
        AND (${empleado_id}::uuid IS NULL OR j.empleado_id = ${empleado_id})
        AND j.fin IS NOT NULL
      ORDER BY j.fecha ASC
    `;

    const reporte = [];
    const empresaId = jornadas[0]?.empresa_id || (await getEmpresaByUserId(req.user.id)); // Fallback logic needed if no jornadas

    // Si no hay jornadas, quizá queremos ver días sin fichar donde había plan?
    // Por ahora nos centramos en comparar lo fichado vs lo planeado.

    for (const j of jornadas) {
      // 2. Resolver plan para ese día/empleado
      const plan = await resolverPlanDia({
        empresaId: empresaId, // TODO: need robust way to get enterprise ID
        empleadoId: j.empleado_id,
        fecha: ymd(j.fecha),
      });

      if (!plan.rango) {
        // Trabajó sin plan
        reporte.push({
          ...j,
          plan: null,
          desviacion_inicio: null,
          desviacion_duracion: null,
          estado: "extras_no_planificadas"
        });
        continue;
      }

      // 3. Comparar
      const planInicioStr = `${ymd(j.fecha)}T${plan.rango.inicio}`;
      const planFinStr = `${ymd(j.fecha)}T${plan.rango.fin}`;
      
      const diffInicio = diffMinutes(planInicioStr, j.inicio); // + llegó tarde, - llegó pronto
      const planDuracion = diffMinutes(planInicioStr, planFinStr);
      const realDuracion = j.minutos_trabajados; // Asumiendo que esto resta descansos correctamente
      
      const diffDuracion = realDuracion - planDuracion; // + trabajó más, - trabajó menos

      reporte.push({
        id: j.id,
        empleado_id: j.empleado_id,
        nombre: j.nombre,
        fecha: ymd(j.fecha),
        real: { inicio: j.inicio, fin: j.fin, duracion: realDuracion },
        plan: { inicio: planInicioStr, fin: planFinStr, duracion: planDuracion },
        desviacion: {
          inicio_min: Math.round(diffInicio),
          duracion_min: Math.round(diffDuracion),
          cumple_inicio: Math.abs(diffInicio) < 15, // Umbral 15 min
          cumple_duracion: Math.abs(diffDuracion) < 30 // Umbral 30 min
        }
      });
    }

    res.json(reporte);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error generando reporte" });
  }
};

async function getEmpresaByUserId(uid) {
  const r = await sql`select id from empresa_180 where user_id=${uid}`;
  return r[0]?.id;
}
