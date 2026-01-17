// src/controllers/calendarioController.js
import { sql } from "../db.js";

// -------------------------
// Utils fecha YYYY-MM-DD
// -------------------------
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
      avisos_count: null,
      tiene_incidencias: null,
    };
    cur = addDays(cur, 1);
  }

  return map;
};

// -------------------------
// Rango fechas (mes actual)
// -------------------------
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

// =====================================================
// CALENDARIO USUARIO (daily) -> /calendario/usuario
// =====================================================
export const getCalendarioUsuario = async (req, res) => {
  try {
    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);
    const dayMap = buildDayMap(desde, hasta);

    const empleadoId = req.user.empleado_id;
    const empresaId = req.user.empresa_id;

    if (!empleadoId || !empresaId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    // -------------------------
    // 1) Festivos / calendario empresa
    // (si no existe fila, asumimos laborable=true)
    // -------------------------
    const calEmpresa = await sql`
      SELECT fecha::date AS dia, es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    for (const r of calEmpresa) {
      const dia = toYMD(r.dia);
      if (dayMap[dia]) {
        dayMap[dia].es_laborable = r.es_laborable !== false;
      }
    }

    // -------------------------
    // 2) Ausencias del empleado (pisa laborable a false)
    // -------------------------
    const ausencias = await sql`
      SELECT tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
      ORDER BY fecha_inicio ASC
    `;

    for (const a of ausencias) {
      let cur = toYMD(a.fecha_inicio);
      const end = toYMD(a.fecha_fin);

      while (cur <= end) {
        if (dayMap[cur]) {
          dayMap[cur].ausencia_tipo = a.tipo;
          dayMap[cur].estado = a.estado;
          dayMap[cur].es_laborable = false;
          // Si hay ausencia, no mostramos minutos trabajados (tu frontend lo usa así)
          dayMap[cur].minutos_trabajados = null;
        }
        cur = addDays(cur, 1);
      }
    }

    // -------------------------
    // 3) Jornadas diarias (minutos reales)
    // Regla: se resta SOLO comida; pausa NO cuenta como trabajado.
    // Usamos: minutos_trabajados - minutos_descanso
    // -------------------------
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

      // Si hay ausencia, no pisamos
      if (dayMap[dia].ausencia_tipo) continue;

      const trabajado = Number(j.minutos_trabajados || 0);
      const comida = Number(j.minutos_comida || 0);

      // pausa NO cuenta: ya viene descontada en minutos_trabajados
      // comida sí se descuenta aquí:
      const neto = Math.max(0, trabajado - comida);

      dayMap[dia].minutos_trabajados = neto;
      dayMap[dia].estado = j.estado || dayMap[dia].estado;
    }

    return res.json(Object.values(dayMap));
  } catch (err) {
    console.error("❌ Error en getCalendarioUsuario:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener calendario del usuario" });
  }
};

// =====================================================
// CALENDARIO EMPRESA (daily) -> /calendario/empresa
// Devuelve por empleado: { empleado_id, empleado_nombre, dias: BackendDia[] }
// =====================================================
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

    // Calendario empresa (festivos)
    const calEmpresa = await sql`
      SELECT fecha::date AS dia, es_laborable
      FROM calendario_empresa_180
      WHERE empresa_id = ${empresaId}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;
    const festivosMap = new Map(
      calEmpresa.map((r) => [toYMD(r.dia), r.es_laborable !== false])
    );

    // Ausencias empresa
    const ausencias = await sql`
      SELECT empleado_id, tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empresa_id = ${empresaId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
      ORDER BY fecha_inicio ASC
    `;

    // Jornadas empresa (diarias)
    const jornadas = await sql`
      SELECT
        empleado_id,
        fecha::date AS dia,
        COALESCE(minutos_trabajados, 0) AS minutos_trabajados,
        COALESCE(minutos_descanso, 0) AS minutos_comida,
        estado
      FROM jornadas_180
      WHERE empresa_id = ${empresaId}
        AND empleado_id = ANY(${empleadoIds})
        AND fecha::date BETWEEN ${desde} AND ${hasta}
    `;

    // Index por empleado
    const out = [];

    for (const emp of empleados) {
      const dayMap = buildDayMap(desde, hasta);

      // aplicar festivos empresa
      for (const dia of Object.keys(dayMap)) {
        if (festivosMap.has(dia)) {
          dayMap[dia].es_laborable = festivosMap.get(dia) === true;
        }
      }

      // aplicar ausencias del empleado
      for (const a of ausencias) {
        if (a.empleado_id !== emp.id) continue;

        let cur = toYMD(a.fecha_inicio);
        const end = toYMD(a.fecha_fin);

        while (cur <= end) {
          if (dayMap[cur]) {
            dayMap[cur].ausencia_tipo = a.tipo;
            dayMap[cur].estado = a.estado;
            dayMap[cur].es_laborable = false;
            dayMap[cur].minutos_trabajados = null;
          }
          cur = addDays(cur, 1);
        }
      }

      // aplicar jornadas del empleado
      for (const j of jornadas) {
        if (j.empleado_id !== emp.id) continue;

        const dia = toYMD(j.dia);
        if (!dayMap[dia]) continue;
        if (dayMap[dia].ausencia_tipo) continue;

        const trabajado = Number(j.minutos_trabajados || 0);
        const comida = Number(j.minutos_comida || 0);
        const neto = Math.max(0, trabajado - comida);

        dayMap[dia].minutos_trabajados = neto;
        dayMap[dia].estado = j.estado || dayMap[dia].estado;
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

// =====================================================
// ESTADO HOY USUARIO (sin cambios relevantes)
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
