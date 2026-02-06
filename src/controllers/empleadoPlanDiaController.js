// backend/src/controllers/empleadoPlanDiaController.js
import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";
import { recalcularJornada } from "../services/jornadaEngine.js";

// YYYY-MM-DD
function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

async function getEmpleadoFromUser(userId) {
  const rows = await sql`
    SELECT id, empresa_id, activo, turno_id
    FROM employees_180
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getTurno(empresaId, turnoId) {
  if (!turnoId) return null;
  const rows = await sql`
    SELECT id, nombre, descripcion, tipo_turno, tipo_horario,
           horas_dia_objetivo, max_horas_dia, max_horas_semana,
           minutos_descanso_min, minutos_descanso_max, nocturno_permitido
    FROM turnos_180
    WHERE id = ${turnoId}
      AND empresa_id = ${empresaId}
      AND activo = true
    LIMIT 1
  `;
  return rows[0] || null;
}

// Busca jornada por fecha (no inventa, no crea)
async function getJornadaByFecha({ empleadoId, fecha }) {
  const rows = await sql`
    SELECT *
    FROM jornadas_180
    WHERE empleado_id = ${empleadoId}
      AND fecha = ${fecha}::date
    ORDER BY inicio DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

// Estado fichaje minimal (sin depender de otro controller)
async function getEstadoFichajeMin({ userId, empleadoId }) {
  const lastRows = await sql`
    SELECT f.*
    FROM fichajes_180 f
    WHERE f.user_id = ${userId}
      AND f.empleado_id = ${empleadoId}
    ORDER BY f.fecha DESC
    LIMIT 1
  `;
  const last = lastRows[0] || null;

  let estado = "fuera";
  if (last) {
    if (last.tipo === "entrada" || last.tipo === "descanso_fin")
      estado = "dentro";
    if (last.tipo === "descanso_inicio") estado = "descanso";
    if (last.tipo === "salida") estado = "fuera";
  }

  let acciones = [];
  if (estado === "fuera") acciones = ["entrada"];
  if (estado === "dentro") acciones = ["salida", "descanso_inicio"];
  if (estado === "descanso") acciones = ["descanso_fin"];

  return { estado, ultimo_fichaje: last, acciones_permitidas: acciones };
}

export async function getEmpleadoPlanDia(req, res) {
  try {
    const fecha = String(req.query.fecha || todayYMD());

    // empleado del JWT
    const emp = await getEmpleadoFromUser(req.user.id);
    if (!emp) return res.status(403).json({ error: "Usuario no es empleado" });
    if (!emp.activo)
      return res.status(403).json({ error: "Empleado desactivado" });

    const empleadoId = emp.id;
    const empresaId = emp.empresa_id;

    // 1) turno
    const turno = await getTurno(empresaId, emp.turno_id);

    // 2) plan esperado
    const plan = await resolverPlanDia({
      empresaId,
      empleadoId,
      fecha,
    });

    // 3) jornada del día (si existe)
    let jornada = await getJornadaByFecha({ empleadoId, fecha });

    // 4) si hay jornada, asegurar resumen_json actualizado
    if (jornada?.id) {
      // si resumen_json está vacío, o quieres siempre recalcular:
      // (yo recomiendo recalcular siempre por seguridad en MVP)
      jornada = await recalcularJornada(jornada.id);
    }

    // 5) estado fichaje + acciones
    const estado = await getEstadoFichajeMin({
      userId: req.user.id,
      empleadoId,
    });

    return res.json({
      fecha,
      empleado_id: empleadoId,
      empresa_id: empresaId,
      turno,
      plan,
      estado_fichaje: estado,
      jornada: jornada || null,
      resumen: jornada?.resumen_json || null,
      avisos: jornada?.resumen_json?.avisos || [],
    });
  } catch (e) {
    console.error("[getEmpleadoPlanDia] error:", e);
    return res.status(500).json({ error: "Error obteniendo plan del día" });
  }
}
// backend/src/controllers/empleadoPlanDiaController.js
