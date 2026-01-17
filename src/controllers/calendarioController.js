// src/controllers/calendarioController.js
import { sql } from "../db.js";

const toYMD = (v) => String(v).slice(0, 10);

const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

const buildDayMap = (desde, hasta) => {
  const map = {};
  let cur = desde;

  while (cur <= hasta) {
    map[cur] = {
      fecha: cur,
      es_laborable: true,
      ausencia_tipo: null,
      estado: null,
      minutos_trabajados: null,
    };
    cur = addDays(cur, 1);
  }
  return map;
};

const getRangoFechas = (desde, hasta) => {
  if (desde && hasta) return { desde, hasta };

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const toStr = (d) => d.toISOString().split("T")[0];

  return {
    desde: desde || toStr(inicioMes),
    hasta: hasta || toStr(finMes),
  };
};

/**
 * Minutos trabajados del día:
 * - trabajo: suma
 * - pausa: suma (cuenta como trabajado)
 * - comida: resta (solo esto descuenta)
 *
 * Entradas esperadas desde BBDD: tipo in ('trabajo','pausa','comida'),
 * y hora_inicio/hora_fin como time.
 */
const computeMinutosDia = (bloques) => {
  let total = 0;

  for (const b of bloques) {
    const tipo = String(b.tipo || "").toLowerCase();
    const inicio = String(b.hora_inicio).slice(0, 5); // HH:MM
    const fin = String(b.hora_fin).slice(0, 5);

    // diferencia en minutos
    const [ih, im] = inicio.split(":").map(Number);
    const [fh, fm] = fin.split(":").map(Number);

    if (
      Number.isNaN(ih) ||
      Number.isNaN(im) ||
      Number.isNaN(fh) ||
      Number.isNaN(fm)
    ) {
      continue;
    }

    const mins = Math.max(0, fh * 60 + fm - (ih * 60 + im));

    if (tipo === "comida") total -= mins;
    else if (tipo === "trabajo" || tipo === "pausa") total += mins;
    else {
      // si hubiera tipos antiguos o basura, no rompas el calendario
      total += 0;
    }
  }

  return Math.max(0, total);
};

//
// CALENDARIO DEL USUARIO (empleado o autónomo) -> FORMATO DIARIO
//
export const getCalendarioUsuario = async (req, res) => {
  try {
    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);
    const dayMap = buildDayMap(desde, hasta);

    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;

    if (!empleadoId || !empresaId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    // =========================
    // 1) AUSENCIAS DEL EMPLEADO (marcan no laborable)
    // =========================
    const ausencias = await sql`
      SELECT tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
    `;

    for (const a of ausencias) {
      let cur = toYMD(a.fecha_inicio);
      const end = toYMD(a.fecha_fin);

      while (cur <= end) {
        if (dayMap[cur]) {
          dayMap[cur].ausencia_tipo = a.tipo;
          dayMap[cur].estado = a.estado;
          dayMap[cur].es_laborable = false;
        }
        cur = addDays(cur, 1);
      }
    }

    // =========================
    // 2) FESTIVOS DE EMPRESA (si existen en calendario_empresa_180)
    //    OJO: si hay ausencia, la ausencia manda.
    // =========================
    const festivos = await sql`
      SELECT fecha::date AS dia, es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    for (const f of festivos) {
      const dia = toYMD(f.dia);
      if (dayMap[dia] && !dayMap[dia].ausencia_tipo) {
        dayMap[dia].es_laborable = Boolean(f.es_laborable);
      }
    }

    // =========================
    // 3) MINUTOS TRABAJADOS (desde jornadas + bloques)
    //    - Solo descuenta "comida"
    //    - "pausa" cuenta como trabajado
    //    - Si no hay jornada ese día => null
    // =========================
    const jornadas = await sql`
      SELECT id, fecha::date AS dia
      FROM jornadas_180
      WHERE empleado_id = ${empleadoId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    if (jornadas.length > 0) {
      const jornadaIds = jornadas.map((j) => j.id);

      const bloques = await sql`
        SELECT jornada_id, tipo, hora_inicio, hora_fin
        FROM jornada_bloques_180
        WHERE jornada_id = ANY(${jornadaIds})
      `;

      const bloquesPorJornada = new Map();
      for (const b of bloques) {
        const k = b.jornada_id;
        if (!bloquesPorJornada.has(k)) bloquesPorJornada.set(k, []);
        bloquesPorJornada.get(k).push(b);
      }

      for (const j of jornadas) {
        const dia = toYMD(j.dia);
        if (!dayMap[dia]) continue;
        if (dayMap[dia].ausencia_tipo) continue; // ausencia manda

        const lista = bloquesPorJornada.get(j.id) || [];
        const mins = computeMinutosDia(lista);

        // si hay jornada pero 0 minutos, dejamos 0 (para que el frontend pueda mostrarlo)
        dayMap[dia].minutos_trabajados = mins;
      }
    }

    return res.json(Object.values(dayMap));
  } catch (err) {
    console.error("❌ Error en getCalendarioUsuario:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener calendario del usuario" });
  }
};

//
// CALENDARIO DE EMPRESA (solo admin) -> FORMATO DIARIO POR EMPLEADO
//
// Respuesta: [{ empleado_id, empleado_nombre, dias: BackendDia[] }, ...]
//
export const getCalendarioEmpresa = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);

    // Empresa del admin
    const empresaRows = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (empresaRows.length === 0) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }
    const empresaId = empresaRows[0].id;

    // Empleados de la empresa
    const empleados = await sql`
      SELECT e.id, e.nombre
      FROM employees_180 e
      WHERE e.empresa_id = ${empresaId}
      ORDER BY e.nombre ASC
    `;

    if (empleados.length === 0) return res.json([]);

    const empleadoIds = empleados.map((e) => e.id);

    // Festivos empresa (se aplican a todos, salvo ausencia)
    const festivos = await sql`
      SELECT fecha::date AS dia, es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;
    const festivoMap = new Map();
    for (const f of festivos)
      festivoMap.set(toYMD(f.dia), Boolean(f.es_laborable));

    // Ausencias empresa
    const ausencias = await sql`
      SELECT empleado_id, tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empresa_id = ${empresaId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
    `;

    // Jornadas empresa
    const jornadas = await sql`
      SELECT id, empleado_id, fecha::date AS dia
      FROM jornadas_180
      WHERE empleado_id = ANY(${empleadoIds})
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    const jornadaIds = jornadas.map((j) => j.id);
    let bloques = [];
    if (jornadaIds.length > 0) {
      bloques = await sql`
        SELECT jornada_id, tipo, hora_inicio, hora_fin
        FROM jornada_bloques_180
        WHERE jornada_id = ANY(${jornadaIds})
      `;
    }

    const bloquesPorJornada = new Map();
    for (const b of bloques) {
      const k = b.jornada_id;
      if (!bloquesPorJornada.has(k)) bloquesPorJornada.set(k, []);
      bloquesPorJornada.get(k).push(b);
    }

    // Map jornadas por (empleado_id + dia)
    const jornadaPorEmpleadoDia = new Map();
    for (const j of jornadas) {
      jornadaPorEmpleadoDia.set(`${j.empleado_id}::${toYMD(j.dia)}`, j.id);
    }

    // Map ausencias por empleado (por día, para escritura rápida)
    const ausenciasPorEmpleado = new Map();
    for (const a of ausencias) {
      const emp = a.empleado_id;
      if (!ausenciasPorEmpleado.has(emp)) ausenciasPorEmpleado.set(emp, []);
      ausenciasPorEmpleado.get(emp).push(a);
    }

    const out = [];

    for (const emp of empleados) {
      const dayMap = buildDayMap(desde, hasta);

      // aplicar festivos empresa
      for (const dia of Object.keys(dayMap)) {
        if (festivoMap.has(dia)) {
          dayMap[dia].es_laborable = festivoMap.get(dia);
        }
      }

      // aplicar ausencias del empleado (pisan festivo)
      const ausEmp = ausenciasPorEmpleado.get(emp.id) || [];
      for (const a of ausEmp) {
        let cur = toYMD(a.fecha_inicio);
        const end = toYMD(a.fecha_fin);

        while (cur <= end) {
          if (dayMap[cur]) {
            dayMap[cur].ausencia_tipo = a.tipo;
            dayMap[cur].estado = a.estado;
            dayMap[cur].es_laborable = false;
          }
          cur = addDays(cur, 1);
        }
      }

      // minutos trabajados por jornada (si existe)
      for (const dia of Object.keys(dayMap)) {
        if (dayMap[dia].ausencia_tipo) continue;

        const jid = jornadaPorEmpleadoDia.get(`${emp.id}::${dia}`);
        if (!jid) continue;

        const lista = bloquesPorJornada.get(jid) || [];
        dayMap[dia].minutos_trabajados = computeMinutosDia(lista);
      }

      out.push({
        empleado_id: emp.id,
        empleado_nombre: emp.nombre,
        dias: Object.values(dayMap),
      });
    }

    return res.json(out);
  } catch (err) {
    console.error("❌ Error en getCalendarioEmpresa:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener calendario de empresa" });
  }
};

export const getEstadoHoyUsuario = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;

    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const hoy = new Date().toISOString().slice(0, 10);

    // 1) Ausencia aprobada
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

    // 2) Festivo empresa
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
