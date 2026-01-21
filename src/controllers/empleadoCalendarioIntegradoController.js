import { sql } from "../db.js";

function ymd(v) {
  return String(v || "").slice(0, 10);
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function titleForTipo(tipo) {
  const t = String(tipo || "").toLowerCase();

  if (t === "vacaciones") return "Vacaciones";
  if (t === "baja_medica") return "Baja médica";

  if (t === "festivo_local") return "Festivo local";
  if (t === "festivo_nacional") return "Festivo nacional";
  if (t === "festivo_empresa") return "Festivo de empresa";

  if (t === "convenio") return "Ajuste de convenio";
  if (t === "cierre_empresa") return "Cierre de empresa";
  if (t === "no_laborable") return "No laborable";

  if (t === "jornada_real") return "Jornada (real)";
  if (t === "jornada_plan") return "Jornada (plan)";

  return t ? t.replaceAll("_", " ") : "Evento";
}

function normalizeAllDayEvent(ev) {
  const allDay = !!ev.allDay;
  const start = ymd(ev.start);
  let end = ev.end ? ymd(ev.end) : null;

  if (allDay) {
    if (!end) end = addDaysISO(start, 1);
    if (end === start) end = addDaysISO(start, 1);
  }

  return {
    ...ev,
    start,
    end: end || undefined,
    allDay,
  };
}

export async function getCalendarioIntegradoEmpleado(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const desde = ymd(req.query.desde);
    const hasta = ymd(req.query.hasta);

    if (!desde || !hasta) {
      return res
        .status(400)
        .json({ error: "Parámetros desde/hasta requeridos" });
    }

    // 1) empleado
    const rEmp = await sql`
      select id, empresa_id
      from employees_180
      where user_id=${userId}
      limit 1
    `;

    const empleadoId = rEmp[0]?.id;
    const empresaId = rEmp[0]?.empresa_id;

    if (!empleadoId || !empresaId) {
      return res.status(403).json({ error: "Empleado no asociado" });
    }

    // 2) AUSENCIAS
    const aus = await sql`
      select
        'aus-' || a.id as id,
        a.tipo as tipo,
        case when a.tipo='baja_medica' then 'Baja médica' else 'Vacaciones' end as title,
        a.fecha_inicio::text as start,
        (a.fecha_fin::date + interval '1 day')::date::text as end,
        true as "allDay",
        a.estado as estado
      from ausencias_180 a
      where a.empleado_id=${empleadoId}
        and a.estado in ('aprobado','pendiente')
        and a.fecha_inicio <= ${hasta}::date
        and a.fecha_fin >= ${desde}::date
    `;

    // 3) FESTIVOS / CONVENIO / CIERRES (DESDE TU VISTA REAL)
    const cal = await sql`
      select
        'cal-' || row_number() over() as id,
        c.tipo as tipo,
        c.nombre as title,
        c.fecha::text as start,
        (c.fecha::date + interval '1 day')::date::text as end,
        true as "allDay",
        null::text as estado,
        jsonb_build_object(
          'display',
          case
            when c.tipo in (
              'festivo_nacional',
              'festivo_local',
              'festivo_empresa',
              'cierre_empresa',
              'no_laborable'
            ) then 'background'
            else 'block'
          end
        ) as meta
      from v_calendario_empresa_180 c
      where c.empresa_id=${empresaId}
        and c.fecha between ${desde}::date and ${hasta}::date
    `;

    // 4) Unificar
    const merged = [
      ...(Array.isArray(aus) ? aus : []),
      ...(Array.isArray(cal) ? cal : []),
    ].map((e) => {
      const tipo = String(e.tipo || "").toLowerCase();
      const title = e.title || titleForTipo(tipo);

      return normalizeAllDayEvent({
        id: String(e.id),
        tipo,
        title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        estado: e.estado,
        meta: e.meta || undefined,
      });
    });

    return res.json(merged);
  } catch (err) {
    console.error("[getCalendarioIntegradoEmpleado]", err);
    return res.status(500).json({
      error: "Error calendario integrado empleado",
      detail: err?.message || String(err),
    });
  }
}
