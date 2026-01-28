import { sql } from "../db.js";
import { ensureFestivosForYear } from "../services/festivosNagerService.js";

function toYMD(v) {
  if (!v) return null;

  const d = new Date(v);
  return d.toISOString().split("T")[0];
}

function getRangoFechas(desde, hasta) {
  if (desde && hasta) return { desde, hasta };

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

  const toStr = (d) => d.toISOString().split("T")[0];

  return {
    desde: desde || toStr(inicioMes),
    hasta: hasta || toStr(finMes),
  };
}

function buildDayMap(desde, hasta) {
  const map = {};
  let cur = desde;

  while (cur <= hasta) {
    map[cur] = {
      fecha: cur,
      es_laborable: true,

      empresa: null, // { tipo, label, es_laborable }
      festivo_es: null, // { nombre, ambito, comunidad }
      ausencia: null, // { id, tipo, estado }

      minutos_trabajados: null,
      jornada_estado: null,
    };

    const d = new Date(cur);
    d.setDate(d.getDate() + 1);
    cur = d.toISOString().split("T")[0];
  }

  return map;
}

function mkEvent({ id, tipo, title, start, estado }) {
  return {
    id,
    tipo,
    title,
    start,
    allDay: true,
    ...(estado ? { estado } : {}),
  };
}

// PRIORIDAD VISUAL:
// 1) ausencia
// 2) calendario_empresa_180
// 3) festivo_es_180
// 4) trabajado (jornada)
function dayToEvent(d) {
  const fecha = d.fecha;

  // 1) Ausencia
  if (d.ausencia) {
    const pretty =
      d.ausencia.tipo === "baja_medica" ? "Baja médica" : "Vacaciones";
    const st = d.ausencia.estado ? ` (${d.ausencia.estado})` : "";

    return mkEvent({
      id: `aus-${d.ausencia.id}`,
      tipo: d.ausencia.tipo,
      title: `${pretty}${st}`,
      start: fecha,
      estado: d.ausencia.estado,
    });
  }

  // 2) Empresa
  if (d.empresa) {
    const label = d.empresa.label || d.empresa.tipo;
    const tipo = d.empresa.es_laborable ? "laborable_extra" : "festivo";

    return mkEvent({
      id: `emp-${d.empresa.tipo}-${fecha}`,
      tipo,
      title: label,
      start: fecha,
    });
  }

  // 3) Festivo ES
  if (d.festivo_es) {
    return mkEvent({
      id: `fes-${fecha}`,
      tipo: "festivo",
      title: d.festivo_es.nombre || "Festivo",
      start: fecha,
    });
  }

  // 4) Trabajo real
  if (Number(d.minutos_trabajados || 0) > 0) {
    return mkEvent({
      id: `job-${fecha}`,
      tipo: "trabajo",
      title: `Trabajado · ${Math.round(d.minutos_trabajados)}m`,
      start: fecha,
    });
  }

  return null;
}

// =====================================================
// EVENTOS CALENDARIO (MES / SEMANA)
// =====================================================
export const getCalendarioUsuarioEventos = async (req, res) => {
  try {
    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);
    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;

    if (!empleadoId || !empresaId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const y1 = Number(desde.slice(0, 4));
    const y2 = Number(hasta.slice(0, 4));

    await ensureFestivosForYear(y1);
    if (y2 !== y1) await ensureFestivosForYear(y2);

    const dayMap = buildDayMap(desde, hasta);

    // 1) Calendario empresa
    const calEmpresa = await sql`
      SELECT fecha::date AS dia, tipo, COALESCE(label, nombre) AS label, es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    for (const r of calEmpresa) {
      const dia = toYMD(r.dia);
      if (!dayMap[dia]) continue;

      dayMap[dia].empresa = {
        tipo: r.tipo,
        label: r.label,
        es_laborable: r.es_laborable === true,
        prioridad: 2,
      };

      dayMap[dia].es_laborable = r.es_laborable === true;
    }


    // 2) Festivos ES
    const festivos = await sql`
      SELECT fecha::date AS dia, nombre, ambito, comunidad
      FROM festivos_es_180
      WHERE fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    for (const f of festivos) {
      const dia = toYMD(f.dia);
      if (!dayMap[dia]) continue;
      if (dayMap[dia].empresa) continue;

      dayMap[dia].festivo_es = {
        nombre: f.nombre,
        ambito: f.ambito,
        comunidad: f.comunidad,
      };

      dayMap[dia].es_laborable = false;
    }


    // 3) Ausencias
    const ausencias = await sql`
      SELECT id, tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
      ORDER BY fecha_inicio ASC
    `;

    for (const a of ausencias) {
      let cur = new Date(a.fecha_inicio + "T00:00:00");
      const end = new Date(a.fecha_fin + "T00:00:00");

      while (cur <= end) {
        const ymd = cur.toISOString().split("T")[0];
        if (dayMap[ymd]) {
          dayMap[ymd].ausencia = {
            id: a.id,
            tipo: a.tipo,
            estado: a.estado,
          };
          dayMap[ymd].es_laborable = false;
          dayMap[ymd].minutos_trabajados = null;
        }
        cur.setDate(cur.getDate() + 1);
      }
    }


    // 4) Jornadas
    const jornadas = await sql`
      SELECT
        fecha::date AS dia,
        COALESCE(minutos_trabajados, 0) AS minutos_trabajados,
        COALESCE(minutos_descanso, 0) AS minutos_comida,
        estado
      FROM jornadas_180
      WHERE empleado_id = ${empleadoId}
        AND empresa_id = ${empresaId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    for (const j of jornadas) {
      const dia = toYMD(j.dia);
      if (!dayMap[dia]) continue;
      if (
        dayMap[dia].ausencia ||
        dayMap[dia].empresa ||
        dayMap[dia].festivo_es
      ) {
        continue;
      }

      const trabajado = Number(j.minutos_trabajados || 0);
      const comida = Number(j.minutos_comida || 0);
      const neto = Math.max(0, trabajado - comida);

      dayMap[dia].minutos_trabajados = neto;
      dayMap[dia].jornada_estado = j.estado || null;
    }

    for (const d of Object.values(dayMap)) {
      if (d.ausencia || d.empresa || d.festivo_es) {
        d.minutos_trabajados = null;
      }
    }

    const eventos = [];
    for (const d of Object.values(dayMap)) {
      const ev = dayToEvent(d);
      if (ev) eventos.push(ev);
    }

    return res.json(eventos);
  } catch (err) {
    console.error("❌ getCalendarioUsuarioEventos:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener eventos calendario" });
  }
};

// =====================================================
// DETALLE DE DÍA
// =====================================================
export const getDiaUsuarioDetalle = async (req, res) => {
  try {
    const ymd = String(req.query.fecha || "").slice(0, 10);
    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;

    if (!ymd || !empleadoId || !empresaId) {
      return res.status(400).json({ error: "Fecha inválida" });
    }

    const year = Number(ymd.slice(0, 4));
    await ensureFestivosForYear(year);

    const emp = await sql`
      SELECT tipo, COALESCE(label, nombre) AS label, es_laborable, descripcion
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha = ${ymd}
        AND activo = true
      LIMIT 1
    `;

    const aus = await sql`
      SELECT id, tipo, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${ymd}
        AND fecha_fin >= ${ymd}
      LIMIT 1
    `;

    const fes = await sql`
      SELECT nombre
      FROM festivos_es_180
      WHERE fecha = ${ymd}
      LIMIT 1
    `;

    const eventos = [];

    if (aus.length) {
      const a = aus[0];

      eventos.push({
        id: `aus-${a.id}`,
        tipo: a.tipo,
        title: a.tipo === "baja_medica" ? "Baja médica" : "Vacaciones",
        start: ymd,
        allDay: true,
        estado: a.estado,
      });

      return res.json({
        fecha: ymd,
        laborable: false,
        label: a.tipo === "baja_medica" ? "Baja médica" : "Vacaciones",
        eventos,
      });
    }

    if (emp.length) {
      const e = emp[0];
      const label = e.label || e.tipo;

      eventos.push({
        id: `emp-${ymd}`,
        tipo: e.es_laborable ? "laborable_extra" : "festivo",
        title: label,
        start: ymd,
        allDay: true,
      });

      return res.json({
        fecha: ymd,
        laborable: e.es_laborable === true,
        label,
        descripcion: e.descripcion || null,
        eventos,
      });
    }

    if (fes.length) {
      const f = fes[0];

      eventos.push({
        id: `fes-${ymd}`,
        tipo: "festivo",
        title: f.nombre || "Festivo",
        start: ymd,
        allDay: true,
      });

      return res.json({
        fecha: ymd,
        laborable: false,
        label: f.nombre || "Festivo",
        eventos,
      });
    }

    return res.json({
      fecha: ymd,
      laborable: true,
      label: "Laborable",
      eventos: [],
    });
  } catch (err) {
    console.error("❌ getDiaUsuarioDetalle:", err);
    return res.status(500).json({ error: "Error al obtener detalle del día" });
  }
};

// =====================================================
// ESTADO HOY
// =====================================================
export const getEstadoHoyUsuario = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;

    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const hoy = new Date().toISOString().slice(0, 10);

    const ausencia = await sql`
      SELECT tipo
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${hoy}
        AND fecha_fin >= ${hoy}
      LIMIT 1
    `;

    if (ausencia.length > 0) {
      return res.json({
        laborable: false,
        motivo: ausencia[0].tipo,
        label: ausencia[0].tipo === "vacaciones" ? "Vacaciones" : "Baja médica",
      });
    }

    const festivo = await sql`
      SELECT es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresa_id}
        AND fecha = ${hoy}
      LIMIT 1
    `;

    if (festivo.length > 0 && festivo[0].es_laborable === false) {
      return res.json({
        laborable: false,
        motivo: "festivo",
        label: "Festivo",
      });
    }

    return res.json({ laborable: true });
  } catch (err) {
    console.error("❌ getEstadoHoyUsuario:", err);
    res.status(500).json({ error: "Error comprobando día laboral" });
  }
};
