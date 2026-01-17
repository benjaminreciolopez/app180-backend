import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

function ymd(d) {
  return String(d).slice(0, 10);
}

function combineDateTime(fechaYmd, timeStr) {
  return `${fechaYmd}T${String(timeStr).slice(0, 8)}`;
}

/**
 * EMPLEADO: calendario integrado
 * - calendario empresa / no laborable
 * - ausencias propias (aprobadas o todas si quieres)
 * - jornadas reales propias
 * - plan esperado propio (siempre lo mostramos; es barato)
 *
 * Query:
 *  - desde=YYYY-MM-DD (requerido)
 *  - hasta=YYYY-MM-DD (requerido)
 *  - include_plan=1 (opcional, default 1)
 *  - include_real=1 (opcional, default 1)
 */
export const getCalendarioIntegradoEmpleado = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "Empleado no válido" });
    }

    const { desde, hasta, include_plan, include_real } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ error: "Rango de fechas requerido" });
    }

    const wantPlan = include_plan == null ? true : String(include_plan) === "1";
    const wantReal = include_real == null ? true : String(include_real) === "1";

    const eventos = [];

    // 1) Calendario empresa + no laborable
    const dias = await sql`
      SELECT
        d.fecha,
        d.es_laborable,
        vc.tipo AS cal_tipo,
        vc.nombre AS cal_nombre,
        vc.fuente AS cal_fuente
      FROM v_dia_laborable_empresa_180 d
      LEFT JOIN v_calendario_empresa_180 vc
        ON vc.empresa_id = d.empresa_id
       AND vc.fecha = d.fecha
      WHERE d.empresa_id = ${empresa_id}
        AND d.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY d.fecha
    `;

    for (const d of dias) {
      const fecha = ymd(d.fecha);

      if (d.cal_tipo) {
        const tipo = String(d.cal_tipo);
        eventos.push({
          id: `cal-${tipo}-${fecha}`,
          tipo: "calendario_empresa",
          title: d.cal_nombre
            ? String(d.cal_nombre)
            : tipo.replaceAll("_", " "),
          start: fecha,
          end: null,
          allDay: true,
          estado: null,
          empleado_id,
          empleado_nombre: null,
          meta: { fuente: d.cal_fuente || null, cal_tipo: tipo },
        });
      } else if (d.es_laborable === false) {
        eventos.push({
          id: `no_laborable-${fecha}`,
          tipo: "no_laborable",
          title: "No laborable",
          start: fecha,
          end: null,
          allDay: true,
          estado: null,
          empleado_id,
          empleado_nombre: null,
          meta: null,
        });
      }
    }

    // 2) Ausencias propias (te recomiendo todas, no solo aprobadas, para que el empleado vea pendiente)
    const ausencias = await sql`
      SELECT
        id, tipo, estado, fecha_inicio, fecha_fin
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
        AND empresa_id = ${empresa_id}
        AND fecha_fin >= ${desde}::date
        AND fecha_inicio <= ${hasta}::date
      ORDER BY fecha_inicio ASC
    `;

    for (const a of ausencias) {
      const start = ymd(a.fecha_inicio);
      const end = ymd(a.fecha_fin);

      const title =
        a.tipo === "vacaciones"
          ? "Vacaciones"
          : a.tipo === "baja_medica"
            ? "Baja médica"
            : String(a.tipo);

      eventos.push({
        id: `aus-${a.id}`,
        tipo: "ausencia",
        title,
        start,
        end,
        allDay: true,
        estado: a.estado || null,
        empleado_id,
        empleado_nombre: null,
        meta: { ausencia_tipo: a.tipo },
      });
    }

    // 3) Jornadas reales propias
    if (wantReal) {
      const jornadas = await sql`
        SELECT
          id, fecha, inicio, fin, estado,
          minutos_trabajados, minutos_descanso, minutos_extra,
          resumen_json
        FROM jornadas_180
        WHERE empresa_id = ${empresa_id}
          AND empleado_id = ${empleado_id}
          AND fecha BETWEEN ${desde}::date AND ${hasta}::date
        ORDER BY fecha ASC, inicio ASC
      `;

      for (const j of jornadas) {
        const fecha = j.fecha ? ymd(j.fecha) : j.inicio ? ymd(j.inicio) : null;
        if (!fecha) continue;

        const avisos = j?.resumen_json?.avisos || [];
        const warnCount = Array.isArray(avisos)
          ? avisos.filter(
              (x) => x?.nivel === "warning" || x?.nivel === "danger"
            ).length
          : 0;

        eventos.push({
          id: `jor-${j.id}`,
          tipo: "jornada_real",
          title: `Jornada (${j.estado})`,
          start: j.inicio ? String(j.inicio) : `${fecha}T00:00:00`,
          end: j.fin ? String(j.fin) : null,
          allDay: false,
          estado: j.estado || null,
          empleado_id,
          empleado_nombre: null,
          meta: {
            jornada_id: j.id,
            minutos_trabajados: j.minutos_trabajados,
            minutos_descanso: j.minutos_descanso,
            minutos_extra: j.minutos_extra,
            warn_count: warnCount,
          },
        });
      }
    }

    // 4) Plan esperado propio (por día)
    if (wantPlan) {
      const days = await sql`
        SELECT d::date AS fecha
        FROM generate_series(${desde}::date, ${hasta}::date, interval '1 day') AS d
        ORDER BY d
      `;

      for (const r of days) {
        const fecha = ymd(r.fecha);
        const plan = await resolverPlanDia({
          empresaId: empresa_id,
          empleadoId: empleado_id,
          fecha,
        });

        if (!plan?.plantilla_id) continue;

        const bloques = plan.bloques || [];
        if (!bloques.length && !plan.rango) continue;

        const start = plan.rango?.inicio
          ? combineDateTime(fecha, plan.rango.inicio)
          : `${fecha}T00:00:00`;
        const end = plan.rango?.fin
          ? combineDateTime(fecha, plan.rango.fin)
          : null;

        eventos.push({
          id: `plan-${fecha}`,
          tipo: "jornada_plan",
          title:
            plan.modo === "excepcion" ? "Plan (excepción)" : "Plan (plantilla)",
          start,
          end,
          allDay: false,
          estado: null,
          empleado_id,
          empleado_nombre: null,
          meta: {
            plantilla_id: plan.plantilla_id,
            modo: plan.modo,
            rango: plan.rango || null,
            bloques,
            nota: plan.nota || null,
          },
        });
      }
    }

    return res.json(eventos);
  } catch (err) {
    console.error("❌ getCalendarioIntegradoEmpleado:", err);
    return res.status(500).json({
      error: "Error calendario integrado empleado",
      detail: err.message,
    });
  }
};
