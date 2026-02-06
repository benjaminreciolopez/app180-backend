import { sql } from "../db.js";
import { recalcularJornada } from "../services/jornadaEngine.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

function ymd(d) {
  return String(d).slice(0, 10);
}

export const listEmpleadoJornadas = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "Empleado no válido" });
    }

    const { desde, hasta, estado } = req.query;

    const rows = await sql`
      SELECT
        j.id,
        j.fecha,
        j.inicio,
        j.fin,
        j.estado,
        j.minutos_trabajados,
        j.minutos_descanso,
        j.minutos_extra,
        j.resumen_json
      FROM jornadas_180 j
      WHERE j.empresa_id = ${empresa_id}
        AND j.empleado_id = ${empleado_id}
        AND (${desde}::date IS NULL OR j.fecha >= ${desde}::date)
        AND (${hasta}::date IS NULL OR j.fecha <= ${hasta}::date)
        AND (${estado}::text IS NULL OR j.estado = ${estado}::text)
      ORDER BY j.fecha DESC, j.inicio DESC
      LIMIT 200
    `;

    // opcional: devolver indicadores rápidos
    const out = rows.map((j) => {
      const avisos = j?.resumen_json?.avisos || [];
      const warnCount = Array.isArray(avisos)
        ? avisos.filter((x) => x?.nivel === "warning" || x?.nivel === "danger")
            .length
        : 0;

      return {
        id: j.id,
        fecha: j.fecha,
        inicio: j.inicio,
        fin: j.fin,
        estado: j.estado,
        minutos_trabajados: j.minutos_trabajados,
        minutos_descanso: j.minutos_descanso,
        minutos_extra: j.minutos_extra,
        warn_count: warnCount,
      };
    });

    return res.json(out);
  } catch (e) {
    console.error("[listEmpleadoJornadas] error:", e);
    return res.status(500).json({ error: "Error listando jornadas" });
  }
};

export const getEmpleadoJornadaDetalle = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "Empleado no válido" });
    }

    const jornadaId = req.params.id;

    // 1) jornada (solo suya)
    const jRows = await sql`
      SELECT j.*
      FROM jornadas_180 j
      WHERE j.id = ${jornadaId}
        AND j.empresa_id = ${empresa_id}
        AND j.empleado_id = ${empleado_id}
      LIMIT 1
    `;
    let jornada = jRows[0];
    if (!jornada)
      return res.status(404).json({ error: "Jornada no encontrada" });

    // 2) fichajes jornada (solo para UI)
    const fichajes = await sql`
      SELECT
        f.id, f.tipo, f.fecha, f.estado, f.nota,
        f.direccion, f.ciudad, f.pais
      FROM fichajes_180 f
      WHERE f.jornada_id = ${jornadaId}
      ORDER BY f.fecha ASC
    `;

    // 3) recalcular siempre (recomendado)
    jornada = await recalcularJornada(jornadaId);

    // 4) plan esperado (por fecha)
    const fecha = jornada.fecha
      ? String(jornada.fecha).slice(0, 10)
      : jornada.inicio
        ? ymd(jornada.inicio)
        : null;

    const plan = fecha
      ? await resolverPlanDia({
          empresaId: empresa_id,
          empleadoId: empleado_id,
          fecha,
        })
      : { plantilla_id: null, fecha: null, bloques: [] };

    // 5) respuesta recortada (sin campos sensibles)
    return res.json({
      jornada: {
        id: jornada.id,
        fecha: jornada.fecha,
        inicio: jornada.inicio,
        fin: jornada.fin,
        estado: jornada.estado,
        minutos_trabajados: jornada.minutos_trabajados,
        minutos_descanso: jornada.minutos_descanso,
        minutos_extra: jornada.minutos_extra,
        resumen_json: jornada.resumen_json || null,
      },
      fichajes: fichajes.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        fecha: f.fecha,
        estado: f.estado,
        nota: f.nota,
        ubicacion:
          [f.direccion, f.ciudad, f.pais].filter(Boolean).join(" · ") || null,
      })),
      plan,
      avisos: jornada?.resumen_json?.avisos || [],
    });
  } catch (e) {
    console.error("[getEmpleadoJornadaDetalle] error:", e);
    return res
      .status(500)
      .json({ error: "Error obteniendo detalle de jornada" });
  }
};
