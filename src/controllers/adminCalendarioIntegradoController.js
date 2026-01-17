import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

/**
 * ADMIN: calendario integrado
 * - calendario empresa (festivos / no laborable / extras)
 * - ausencias
 * - jornadas reales (resumen + avisos)
 * - plan esperado (plantilla) opcional
 *
 * Query:
 *  - desde=YYYY-MM-DD (requerido)
 *  - hasta=YYYY-MM-DD (requerido)
 *  - empleado_id=uuid (opcional)
 *  - include_plan=1 (opcional)  -> genera "jornada_plan" por dia
 *  - include_real=1 (opcional)  -> incluye jornadas reales (por defecto sí)
 */
async function getEmpresaAdmin(req) {
  const rows = await sql`
    SELECT id
    FROM empresa_180
    WHERE user_id = ${req.user.id}
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

function ymd(d) {
  return String(d).slice(0, 10);
}

function combineDateTime(fechaYmd, timeStr) {
  // timeStr: "HH:MM:SS"
  return `${fechaYmd}T${String(timeStr).slice(0, 8)}`;
}

export const getCalendarioIntegradoAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { desde, hasta, empleado_id, include_plan, include_real } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ error: "Rango de fechas requerido" });
    }

    const empresaId = await getEmpresaAdmin(req);
    if (!empresaId)
      return res.status(400).json({ error: "Empresa no encontrada" });

    const empleadoIdSafe =
      empleado_id && empleado_id !== "" ? String(empleado_id) : null;
    const wantPlan = String(include_plan || "") === "1";
    const wantReal = include_real == null ? true : String(include_real) === "1";

    const eventos = [];

    // 1) Calendario empresa (v_calendario_empresa_180) + laborable (v_dia_laborable_empresa_180)
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
      WHERE d.empresa_id = ${empresaId}
        AND d.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY d.fecha
    `;

    for (const d of dias) {
      const fecha = ymd(d.fecha);

      if (d.cal_tipo) {
        const tipo = String(d.cal_tipo); // festivo_nacional / festivo_local / cierre / laborable_extra...
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
          empleado_id: null,
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
          empleado_id: null,
          empleado_nombre: null,
          meta: null,
        });
      }
    }

    // 2) Ausencias (admin ve todas o filtradas por empleado)
    const ausencias = await sql`
      SELECT
        a.id,
        a.empleado_id,
        e.nombre AS empleado_nombre,
        a.tipo,
        a.estado,
        a.fecha_inicio,
        a.fecha_fin
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND a.fecha_fin >= ${desde}::date
        AND a.fecha_inicio <= ${hasta}::date
        AND (${empleadoIdSafe}::uuid IS NULL OR a.empleado_id = ${empleadoIdSafe}::uuid)
      ORDER BY a.fecha_inicio ASC
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
        title: empleadoIdSafe ? title : `${a.empleado_nombre}: ${title}`,
        start,
        end, // para allDay multi-day, FullCalendar suele usar end exclusivo; si te da problemas, sumamos +1 día (frontend)
        allDay: true,
        estado: a.estado || null,
        empleado_id: a.empleado_id,
        empleado_nombre: a.empleado_nombre,
        meta: { ausencia_tipo: a.tipo },
      });
    }

    // 3) Jornadas reales (resumen_json + avisos)
    if (wantReal) {
      const jornadas = await sql`
        SELECT
          j.id,
          j.empleado_id,
          e.nombre AS empleado_nombre,
          j.fecha,
          j.inicio,
          j.fin,
          j.estado,
          j.minutos_trabajados,
          j.minutos_descanso,
          j.minutos_extra,
          j.resumen_json
        FROM jornadas_180 j
        JOIN employees_180 e ON e.id = j.empleado_id
        WHERE j.empresa_id = ${empresaId}
          AND j.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND (${empleadoIdSafe}::uuid IS NULL OR j.empleado_id = ${empleadoIdSafe}::uuid)
        ORDER BY j.fecha ASC, j.inicio ASC
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
          title: empleadoIdSafe
            ? `Jornada (${j.estado})`
            : `${j.empleado_nombre}: Jornada (${j.estado})`,
          start: j.inicio ? String(j.inicio) : `${fecha}T00:00:00`,
          end: j.fin ? String(j.fin) : null,
          allDay: false,
          estado: j.estado || null,
          empleado_id: j.empleado_id,
          empleado_nombre: j.empleado_nombre,
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

    // 4) Plan esperado (plantilla) por día (opcional)
    // Nota: para ADMIN esto puede ser costoso si no filtras empleado.
    // Se recomienda usar include_plan=1 solo cuando haya empleado_id.
    if (wantPlan) {
      if (!empleadoIdSafe) {
        // para no reventar: exigimos empleado_id si quieres plan
        return res.status(400).json({
          error:
            "include_plan=1 requiere empleado_id para evitar cargas masivas",
        });
      }

      // Generamos días iterando en SQL (generate_series)
      const days = await sql`
        SELECT d::date AS fecha
        FROM generate_series(${desde}::date, ${hasta}::date, interval '1 day') AS d
        ORDER BY d
      `;

      // Plan por día (resolverPlanDia)
      for (const r of days) {
        const fecha = ymd(r.fecha);
        const plan = await resolverPlanDia({
          empresaId,
          empleadoId: empleadoIdSafe,
          fecha,
        });

        if (!plan?.plantilla_id) continue;

        // Si no hay bloques, no pintamos (menos ruido)
        const bloques = plan.bloques || [];
        if (!bloques.length && !plan.rango) continue;

        const start = plan.rango?.inicio
          ? combineDateTime(fecha, plan.rango.inicio)
          : `${fecha}T00:00:00`;
        const end = plan.rango?.fin
          ? combineDateTime(fecha, plan.rango.fin)
          : null;

        eventos.push({
          id: `plan-${empleadoIdSafe}-${fecha}`,
          tipo: "jornada_plan",
          title:
            plan.modo === "excepcion" ? "Plan (excepción)" : "Plan (plantilla)",
          start,
          end,
          allDay: false,
          estado: null,
          empleado_id: empleadoIdSafe,
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
    console.error("❌ getCalendarioIntegradoAdmin:", err);
    return res.status(500).json({
      error: "Error calendario integrado admin",
      detail: err.message,
    });
  }
};
