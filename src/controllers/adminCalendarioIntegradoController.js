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
    let ausenciasQuery = sql`
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
    `;

    if (empleadoIdSafe) {
        ausenciasQuery = sql`${ausenciasQuery} AND a.empleado_id = ${empleadoIdSafe}`;
    }

    const ausencias = await sql`${ausenciasQuery} ORDER BY a.fecha_inicio ASC`;

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
      let jornadasQuery = sql`
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
      `;

      if (empleadoIdSafe) {
          jornadasQuery = sql`${jornadasQuery} AND j.empleado_id = ${empleadoIdSafe}`;
      }

      const jornadas = await sql`${jornadasQuery} ORDER BY j.fecha ASC, j.inicio ASC`;

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
    // =========================
    // 4) Plan V5: Asignaciones Continuas (Gantt-like)
    // =========================
    if (wantPlan) {
      // a) Mapa de bloqueos (días donde NO se debería trabajar por defecto)
      //    Prioridad: Festivo > Ausencia > No Laborable
      //    Usamos un Set con fechas YYYY-MM-DD
      const diasBloqueados = new Map(); // fecha -> motivo

      // Festivos
      eventos.filter(e => e.tipo === 'calendario_empresa' || e.tipo === 'no_laborable').forEach(e => {
        let d = e.start;
        // Asumimos festivos de 1 día (allDay). Si fueran rangos, habría que iterar.
        // Nager devuelve fechas puntuales, calendar_empresa y no_laborable también en este controller.
        diasBloqueados.set(d, e.tipo === 'no_laborable' ? 'no_lab' : 'festivo');
      });
      
      // Ausencias (pueden ser rangos)
      // Como ya las tenemos en 'ausencias' query, las iteramos
      // OJO: Las ausencias son específicas por empleado.
      // El mapa de bloqueos global solo sirve para festivos/no laborables.
      // Para ausencias, consultaremos al procesar cada empleado.

      // b) Consultar asignaciones que se solapan con el rango
      let asignacionesQuery = sql`
        SELECT 
          a.id,
          a.empleado_id,
          e.nombre as empleado_nombre,
          a.plantilla_id,
          p.nombre as plantilla_nombre,
          a.cliente_id,
          c.nombre as cliente_nombre,
          a.fecha_inicio,
          a.fecha_fin,
          a.alias,
          a.color,
          a.ignorar_festivos
        FROM empleado_plantillas_180 a
        LEFT JOIN employees_180 e ON e.id = a.empleado_id
        JOIN plantillas_jornada_180 p ON p.id = a.plantilla_id
        LEFT JOIN clients_180 c ON c.id = a.cliente_id
        WHERE a.empresa_id = ${empresaId}
          AND a.fecha_inicio <= ${hasta}::date
          AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${desde}::date)
      `;

      if (empleadoIdSafe) {
           // Si se filtra por empleado, traemos SUS asignaciones OR asignaciones vacantes (generales)
           // SI se quiere ver las generales también.
           // Pero si el usuario dice "no carga EL planing", probablemente quiere ver SU planing.
           // Mantengamos la lógica estricta: solo SU ID.
           asignacionesQuery = sql`${asignacionesQuery} AND a.empleado_id = ${empleadoIdSafe}`;
      }
      
      const asignaciones = await sql`${asignacionesQuery}`;

      // Cache de ausencias por empleado para lookup rápido
      const ausenciasPorEmpleado = new Map(); // id -> [ {start, end} ]
      eventos.filter(e => e.tipo === 'ausencia').forEach(aus => {
        if (!aus.empleado_id) return;
        if (!ausenciasPorEmpleado.has(aus.empleado_id)) ausenciasPorEmpleado.set(aus.empleado_id, []);
        ausenciasPorEmpleado.get(aus.empleado_id).push({ start: aus.start, end: aus.end });
      });

      for (const asig of asignaciones) {
        // Rango efectivo de la asignación dentro de la vista
        const asigInicio = ymd(asig.fecha_inicio);
        const asigFin = asig.fecha_fin ? ymd(asig.fecha_fin) : hasta; // Acotado a vista si es infinito
        
        // Clamp al rango de vista [desde, hasta]
        const rangeStart = asigInicio < desde ? desde : asigInicio;
        const rangeEnd = (asigFin > hasta || !asig.fecha_fin) ? hasta : asigFin; 

        if (rangeStart > rangeEnd) continue;

        const chunks = [];
        let currentChunk = null;

        // Iterar día a día para "cortar" en conflictos
        // Generamos fechas desde rangeStart hasta rangeEnd
        const dCursor = new Date(rangeStart);
        const dEnd = new Date(rangeEnd);

        while (dCursor <= dEnd) {
          const hoyYmd = ymd(dCursor);
          
          let bloqueado = false;
          // 1. Check Global (Festivos / No Lab)
          if (diasBloqueados.has(hoyYmd)) {
            bloqueado = true;
          }

          // 2. Check Ausencia Empleado
          if (!bloqueado && asig.empleado_id && ausenciasPorEmpleado.has(asig.empleado_id)) {
            // Verificar solape con alguna ausencia
            // Ausencia events son start (YMD) -> end (YMD exclusive)
            // Aquí dCursor es YMD. Check si start <= hoy < end
            const ausList = ausenciasPorEmpleado.get(asig.empleado_id);
            if (ausList.some(a => hoyYmd >= a.start && hoyYmd < a.end)) {
              bloqueado = true;
            }
          }

          // Si ignorar_festivos es true, NUNCA está bloqueado por festivos/ausencias
          if (asig.ignorar_festivos) bloqueado = false;

          if (!bloqueado) {
            // Día laborable para el plan
            if (!currentChunk) {
              currentChunk = { start: hoyYmd, end: hoyYmd };
            } else {
              currentChunk.end = hoyYmd; // Extendemos
            }
          } else {
            // Día bloqueado -> Cerrar chunk anterior si existe
            if (currentChunk) {
              chunks.push(currentChunk);
              currentChunk = null;
            }
          }

          dCursor.setDate(dCursor.getDate() + 1);
        }
        
        // Push último chunk
        if (currentChunk) chunks.push(currentChunk);

        // Crear eventos para cada chunk
        chunks.forEach((chk, idx) => {
          // Ajustar end param para FullCalendar (exclusive)
          const endExclusive = addOneDayYMD(chk.end);
          
          const tituloPrincipal = asig.alias || asig.plantilla_nombre || "Planing";
          const subtitle = asig.cliente_nombre ? `➜ ${asig.cliente_nombre}` : "";

          eventos.push({
            id: `plan-asig-${asig.id}-${idx}`,
            tipo: "jornada_plan", // Mantenemos tipo para compatibilidad de color/iconos base
            title: tituloPrincipal,
            start: chk.start,
            end: endExclusive,
            allDay: true, // V5: Barras continuas son AllDay
            empleado_id: asig.empleado_id,
            empleado_nombre: asig.empleado_nombre || "Sin Asignar",
            backgroundColor: asig.color || undefined, // Nuevo campo color
            borderColor: asig.color || undefined,
            meta: {
              es_asignacion: true, // Flag para diferenciar en frontend
              asignacion_id: asig.id,
              plantilla_id: asig.plantilla_id,
              cliente_nombre: asig.cliente_nombre,
              alias: asig.alias,
              bloques: [] // No tenemos detalle de horas aquí, frontend pedirá si hace click (o no)
            }
          });
        });
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
