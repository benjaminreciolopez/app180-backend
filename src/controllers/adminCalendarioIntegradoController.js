// backend/src/controllers/adminCalendarioIntegradoController.js
import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";
import { ensureFestivosForYear } from "../services/festivosNagerService.js";

function ymd(d) {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addOneDayYMD(ymdStr) {
  const d = new Date(`${ymdStr}T00:00:00`);
  if (isNaN(d.getTime())) return ymdStr;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function combineDateTime(fechaYmd, timeStr) {
  return `${fechaYmd}T${String(timeStr).slice(0, 8)}`;
}

async function getEmpresaAdmin(req) {
  const rows = await sql`
    SELECT id
    FROM empresa_180
    WHERE user_id = ${req.user.id}
    LIMIT 1
  `;
  return rows[0]?.id || null;
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
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const y1 = Number(String(desde).slice(0, 4));
    const y2 = Number(String(hasta).slice(0, 4));
    if (Number.isFinite(y1)) await ensureFestivosForYear(y1);
    if (Number.isFinite(y2) && y2 !== y1) await ensureFestivosForYear(y2);

    const empleadoIdSafe = empleado_id || null;
    const wantPlan = String(include_plan || "") === "1";
    const wantReal = include_real == null ? true : String(include_real) === "1";

    const eventos = [];
    // =========================
    // 0) Festivos nacionales (Nager -> festivos_es_180)
    // =========================
    const festivos = await sql`
  SELECT fecha, nombre, ambito, comunidad
  FROM festivos_es_180
  WHERE fecha BETWEEN ${desde}::date AND ${hasta}::date
  ORDER BY fecha ASC
`;

    for (const f of festivos) {
      const fecha = ymd(f.fecha);
      const endExclusive = addOneDayYMD(fecha);

      eventos.push({
        id: `festivo-${fecha}`,
        tipo: "calendario_empresa",
        title: f.nombre || "Festivo",
        start: fecha,
        end: endExclusive,
        allDay: true,
        estado: null,
        empleado_id: null,
        empleado_nombre: null,
        meta: {
          fuente: "nager",
          ambito: f.ambito,
          comunidad: f.comunidad,
        },
      });
    }

    // =========================
    // 1) Calendario empresa + no laborables
    // =========================
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
      const endExclusive = addOneDayYMD(fecha);

      if (d.cal_tipo) {
        const tipo = String(d.cal_tipo);
        eventos.push({
          id: `cal-${tipo}-${fecha}`,
          tipo: "calendario_empresa",
          title: d.cal_nombre || tipo.replaceAll("_", " "),
          start: fecha,
          end: endExclusive,
          allDay: true,
          estado: null,
          empleado_id: null,
          empleado_nombre: null,
          meta: { fuente: d.cal_fuente || null, cal_tipo: tipo },
        });
      } else if (
        d.es_laborable === false &&
        !eventos.some(
          (ev) => ev.start === fecha && ev.tipo === "calendario_empresa",
        )
      ) {
        eventos.push({
          id: `no-lab-${fecha}`,
          tipo: "no_laborable",
          title: "No laborable",
          start: fecha,
          end: endExclusive,
          allDay: true,
          estado: null,
          empleado_id: null,
          empleado_nombre: null,
          meta: null,
        });
      }
    }

    // =========================
    // 2) Ausencias
    // =========================
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
      const endExclusive = addOneDayYMD(ymd(a.fecha_fin));

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
        end: endExclusive,
        allDay: true,
        estado: a.estado || null,
        empleado_id: a.empleado_id,
        empleado_nombre: a.empleado_nombre,
        meta: { ausencia_tipo: a.tipo },
      });
    }

    // =========================
    // 3) Jornadas reales
    // =========================
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
              (x) => x?.nivel === "warning" || x?.nivel === "danger",
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

    // =========================
    // 4) Plan (opcional)
    // =========================
    if (wantPlan) {
      if (empleadoIdSafe) {
        // Caso A: Un solo empleado (o Admin específico) -> Iterar días
        const days = await sql`
          SELECT d::date AS fecha
          FROM generate_series(${desde}::date, ${hasta}::date, interval '1 day') AS d
          ORDER BY d
        `;

        for (const r of days) {
          const fecha = ymd(r.fecha);
          const plan = await resolverPlanDia({
            empresaId,
            empleadoId: empleadoIdSafe,
            fecha,
          });

          if (!plan?.plantilla_id) continue;
          pushPlan(plan, empleadoIdSafe, null); // Helper interno
        }
      } else {
        // Caso B: TODOS los empleados (o Admin sin ID) -> Buscar asignaciones activas
        // Recuperamos empleados con asignaciones en este rango
        // + el admin si tiene asignaciones (empleado_id IS NULL)
        const asignaciones = await sql`
          SELECT DISTINCT empleado_id
          FROM empleado_plantillas_180
          WHERE empresa_id = ${empresaId}
            AND fecha_inicio <= ${hasta}::date
            AND (fecha_fin IS NULL OR fecha_fin >= ${desde}::date)
        `;

        // Añadimos null explícitamente si hay asignaciones de admin
        const adminAsig = await sql`
          SELECT 1 FROM empleado_plantillas_180 
          WHERE empresa_id=${empresaId} AND empleado_id IS NULL 
          AND fecha_inicio <= ${hasta}::date AND (fecha_fin IS NULL OR fecha_fin >= ${desde}::date)
          LIMIT 1
        `;
        
        let targetIds = asignaciones.map(a => a.empleado_id);
        if (adminAsig.length) targetIds.push(null);

        // Iterar días para cada ID encontrado (puede ser costoso si son muchos empleados y muchos días, 
        // pero es más seguro para reutilizar resolverPlanDia que reescribirlo todo en SQL)
        // TODO: Optimizar a futuro con una mega-query si el rendimiento cae.
        
        // Pre-fetch fechas
        const days = await sql`
          SELECT d::date AS fecha
          FROM generate_series(${desde}::date, ${hasta}::date, interval '1 day') AS d
          ORDER BY d
        `;

        for (const targetId of targetIds) {
          // Para cada empleado con asignaciones, recuperamos sus días
          for (const r of days) {
            const fecha = ymd(r.fecha);
            const plan = await resolverPlanDia({
              empresaId,
              empleadoId: targetId,
              fecha,
            });

            if (!plan?.plantilla_id) continue;
            pushPlan(plan, targetId, await getNombreEmpleado(targetId));
          }
        }
      }

      function pushPlan(plan, eId, eNombre) {
        const bloques = plan.bloques || [];
        if (!bloques.length && !plan.rango) return;

        const fecha = plan.fecha;
        const start = plan.rango?.inicio
          ? combineDateTime(fecha, plan.rango.inicio)
          : `${fecha}T00:00:00`;
        const end = plan.rango?.fin
          ? combineDateTime(fecha, plan.rango.fin)
          : null;

        const label = !eId ? "Admin Plan" : "Plan";
        const titleFinal = eNombre 
          ? `${eNombre}: ${label} (plantilla)`
          : plan.modo === "excepcion" ? `${label} (excep.)` : `${label} (plantilla)`;

        eventos.push({
          id: `plan-${eId || "admin"}-${fecha}`,
          tipo: "jornada_plan",
          title: titleFinal,
          start,
          end,
          allDay: false,
          estado: null,
          empleado_id: eId,
          empleado_nombre: eNombre,
          meta: {
            plantilla_id: plan.plantilla_id,
            modo: plan.modo,
            rango: plan.rango || null,
            bloques,
            nota: plan.nota || null,
          },
        });
      }

      async function getNombreEmpleado(id) {
         if(!id) return "Administrador";
         const r = await sql`select nombre from employees_180 where id=${id}`;
         return r[0]?.nombre || "Desconocido";
      }
    }

    res.set("Cache-Control", "no-store");
    return res.json(eventos);
  } catch (err) {
    console.error("❌ getCalendarioIntegradoAdmin:", err);
    return res.status(500).json({
      error: "Error calendario integrado admin",
      detail: err.message,
    });
  }
};
