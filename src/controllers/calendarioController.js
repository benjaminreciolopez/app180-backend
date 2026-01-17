import { sql } from "../db.js";

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

//
// Utilidad para obtener rango por defecto (mes actual)
//
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

//
// CALENDARIO DEL USUARIO (NORMALIZADO A DÍAS)
//
export const getCalendarioUsuario = async (req, res) => {
  try {
    const { desde, hasta } = getRangoFechas(req.query.desde, req.query.hasta);
    const dayMap = buildDayMap(desde, hasta);

    const empleadoId = req.user.empleado_id;
    if (!empleadoId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    // =========================
    // AUSENCIAS
    // =========================
    const ausencias = await sql`
      SELECT tipo, fecha_inicio, fecha_fin, estado
      FROM ausencias_180
      WHERE empleado_id = ${empleadoId}
        AND fecha_inicio <= ${hasta}
        AND fecha_fin >= ${desde}
    `;

    for (const a of ausencias) {
      let cur = a.fecha_inicio.slice(0, 10);
      const end = a.fecha_fin.slice(0, 10);

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
    // MINUTOS TRABAJADOS (solo si no hay ausencia)
    // =========================
    const fichajes = await sql`
      SELECT
        fecha::date AS dia,
        SUM(minutos) AS minutos
      FROM fichajes_180
      WHERE user_id = ${req.user.id}
        AND fecha::date BETWEEN ${desde} AND ${hasta}
      GROUP BY dia
    `;

    for (const f of fichajes) {
      const dia = f.dia.toISOString().slice(0, 10);
      if (dayMap[dia] && !dayMap[dia].ausencia_tipo) {
        dayMap[dia].minutos_trabajados = Number(f.minutos);
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
// ESTADO HOY (para dashboard)
//
export const getEstadoHoyUsuario = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;

    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const hoy = new Date().toISOString().slice(0, 10);

    // 1️⃣ Ausencia aprobada
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

    // 2️⃣ Festivo empresa
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

    // 3️⃣ Laborable
    return res.json({ laborable: true });
  } catch (err) {
    console.error("❌ getEstadoHoyUsuario:", err);
    res.status(500).json({ error: "Error comprobando día laboral" });
  }
};
