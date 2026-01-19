// =========================
// 1) BACKEND: Controller Admin (añadir festivos + no laborables)
// Archivo sugerido: backend/src/controllers/adminCalendarioIntegradoController.js
// Ruta: GET /admin/calendario/integrado
// =========================

import { sql } from "../db.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";
import { ensureFestivosForYear } from "../services/festivosNagerService.js";

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
 *  - include_plan=1 (opcional)  -> genera "jornada_plan" por dia (requiere empleado_id)
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

function addOneDayYMD(ymdStr) {
  const d = new Date(`${ymdStr}T00:00:00`);
  if (isNaN(d.getTime())) return ymdStr;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function combineDateTime(fechaYmd, timeStr) {
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
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    // Asegurar festivos del/los años implicados (Nager -> festivos_es_180)
    // (Si ya existen, no hace nada)
    const y1 = Number(String(desde).slice(0, 4));
    const y2 = Number(String(hasta).slice(0, 4));
    if (Number.isFinite(y1)) await ensureFestivosForYear(y1);
    if (Number.isFinite(y2) && y2 !== y1) await ensureFestivosForYear(y2);

    const empleadoIdSafe =
      empleado_id && empleado_id !== "" ? String(empleado_id) : null;

    const wantPlan = String(include_plan || "") === "1";
    const wantReal = include_real == null ? true : String(include_real) === "1";

    const eventos = [];

    // =========================
    // 0) Festivos ES (tabla festivos_es_180) -> tipo "calendario_empresa"
    //   - Se muestran para TODOS (no dependen de empleado)
    //   - AllDay con end EXCLUSIVO
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
        id: `festivo-es-${fecha}`,
        tipo: "calendario_empresa",
        title: f.nombre ? String(f.nombre) : "Festivo",
        start: fecha,
        end: endExclusive,
        allDay: true,
        estado: null,
        empleado_id: null,
        empleado_nombre: null,
        meta: {
          fuente: "nager",
          ambito: f.ambito || null,
          comunidad: f.comunidad || null,
        },
      });
    }

    // =========================
    // 1) Días no laborables (por empresa) -> tipo "no_laborable"
    //    (Si tu vista v_dia_laborable_empresa_180 ya contempla reglas internas)
    // =========================
    const diasNoLab = await sql`
      SELECT fecha, es_laborable
      FROM v_dia_laborable_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha BETWEEN ${desde}::date AND ${hasta}::date
        AND es_laborable = false
      ORDER BY fecha ASC
    `;

    for (const d of diasNoLab) {
      const fecha = ymd(d.fecha);
      const endExclusive = addOneDayYMD(fecha);

      // Si ya existe un festivo-es ese día, NO duplicamos "no_laborable"
      // (opcional: si lo quieres, quita este if)
      const alreadyFestivo = eventos.some(
        (x) => x.tipo === "calendario_empresa" && x.start === fecha,
      );
      if (alreadyFestivo) continue;

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
        meta: { fuente: "empresa" },
      });
    }

    // =========================
    // 2) Ausencias (allDay end EXCLUSIVO)
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
    // 3) Jornadas reales (timed)
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

        const ev = {
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
        };

        eventos.push(ev);
      }
    }

    // =========================
    // 4) Plan esperado (opcional) - requiere empleado_id
    // =========================
    if (wantPlan) {
      if (!empleadoIdSafe) {
        return res.status(400).json({
          error:
            "include_plan=1 requiere empleado_id para evitar cargas masivas",
        });
      }

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

        const bloques = plan.bloques || [];
        if (!bloques.length && !plan.rango) continue;

        const ev = {
          id: `plan-${empleadoIdSafe}-${fecha}`,
          tipo: "jornada_plan",
          title:
            plan.modo === "excepcion" ? "Plan (excepción)" : "Plan (plantilla)",
          start: plan.rango?.inicio
            ? combineDateTime(fecha, plan.rango.inicio)
            : `${fecha}T00:00:00`,
          end: plan.rango?.fin ? combineDateTime(fecha, plan.rango.fin) : null,
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
        };

        eventos.push(ev);
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
