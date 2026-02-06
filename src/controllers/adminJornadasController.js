// backend/src/controllers/adminJornadasController.js
import { sql } from "../db.js";
import { recalcularJornada } from "../services/jornadaEngine.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

async function getEmpresaAdmin(req) {
  const rows = await sql`
    SELECT id
    FROM empresa_180
    WHERE user_id = ${req.user.id}
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

export async function getAdminJornadaDetalle(req, res) {
  try {
    const empresaId = await getEmpresaAdmin(req);
    if (!empresaId) return res.status(403).json({ error: "No autorizado" });

    const jornadaId = req.params.id;

    // 1) jornada (must belong to empresa)
    const jRows = await sql`
      SELECT j.*
      FROM jornadas_180 j
      WHERE j.id = ${jornadaId}
        AND j.empresa_id = ${empresaId}
      LIMIT 1
    `;
    let jornada = jRows[0];
    if (!jornada)
      return res.status(404).json({ error: "Jornada no encontrada" });

    // 2) empleado + turno
    const empRows = await sql`
      SELECT e.id, e.nombre, e.user_id, e.turno_id, e.tipo_trabajo
      FROM employees_180 e
      WHERE e.id = ${jornada.empleado_id}
        AND e.empresa_id = ${empresaId}
      LIMIT 1
    `;
    const empleado = empRows[0] || null;

    const turnoRows = empleado?.turno_id
      ? await sql`
          SELECT id, nombre, descripcion, tipo_turno, tipo_horario,
                 horas_dia_objetivo, max_horas_dia, max_horas_semana,
                 minutos_descanso_min, minutos_descanso_max, nocturno_permitido
          FROM turnos_180
          WHERE id = ${empleado.turno_id}
            AND empresa_id = ${empresaId}
            AND activo = true
          LIMIT 1
        `
      : [];
    const turno = turnoRows[0] || null;

    // 3) fichajes jornada
    const fichajes = await sql`
      SELECT f.*
      FROM fichajes_180 f
      WHERE f.jornada_id = ${jornadaId}
      ORDER BY f.fecha ASC
    `;

    // 4) recalcular siempre (recomendado)
    jornada = await recalcularJornada(jornadaId);

    // 5) plan esperado (por fecha)
    const fecha = jornada.fecha
      ? String(jornada.fecha).slice(0, 10)
      : jornada.inicio
        ? String(new Date(jornada.inicio).toISOString().slice(0, 10))
        : null;

    const plan = fecha
      ? await resolverPlanDia({
          empresaId,
          empleadoId: jornada.empleado_id,
          fecha,
        })
      : { plantilla_id: null, fecha: null, bloques: [] };

    return res.json({
      jornada,
      empleado,
      turno,
      fichajes,
      plan,
      resumen: jornada?.resumen_json || null,
      avisos: jornada?.resumen_json?.avisos || [],
    });
  } catch (e) {
    console.error("[getAdminJornadaDetalle] error:", e);
    return res
      .status(500)
      .json({ error: "Error obteniendo detalle de jornada" });
  }
}

export async function listAdminJornadas(req, res) {
  try {
    const empresaId = await getEmpresaAdmin(req);
    if (!empresaId) return res.status(403).json({ error: "No autorizado" });

    const fecha = req.query.fecha ? String(req.query.fecha) : null; // YYYY-MM-DD
    const empleado_id = req.query.empleado_id
      ? String(req.query.empleado_id)
      : null;
    const estado = req.query.estado ? String(req.query.estado) : null; // abierta|cerrada

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
        j.incidencia,
        e.nombre AS empleado_nombre,
        e.id AS empleado_id
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.empresa_id = ${empresaId}
        AND (${fecha}::date IS NULL OR j.fecha = ${fecha}::date)
        AND (${empleado_id}::uuid IS NULL OR j.empleado_id = ${empleado_id}::uuid)
        AND (${estado}::text IS NULL OR j.estado = ${estado}::text)
      ORDER BY j.fecha DESC, j.inicio DESC
      LIMIT 200
    `;

    return res.json(rows);
  } catch (e) {
    console.error("[listAdminJornadas] error:", e);
    return res.status(500).json({ error: "Error listando jornadas" });
  }
}
