// src/controllers/empleadoCalendarioController.js
import { sql } from "../db.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function titleForTipo(tipo, nombre) {
  if (nombre) return nombre;

  switch (tipo) {
    case "festivo_local":
      return "Festivo local";
    case "festivo_nacional":
      return "Festivo nacional";
    case "convenio":
      return "Ajuste de convenio";
    case "cierre_empresa":
      return "Cierre de empresa";
    case "laborable_extra":
      return "Laborable extra";
    case "domingo":
      return "Domingo";
    default:
      return tipo.replaceAll("_", " ");
  }
}

export const getCalendarioHoyEmpleado = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    if (!empleado_id || !empresa_id) {
      return res.status(403).json({ error: "Empleado no válido" });
    }

    const fecha = today();

    // 1️⃣ Calendario empresa
    const cal = await sql`
      SELECT es_laborable
      FROM v_dia_laborable_empresa_180
      WHERE empresa_id = ${empresa_id}
        AND fecha = ${fecha}
      LIMIT 1
    `;

    if (!cal.length || cal[0].es_laborable === false) {
      return res.json({
        fecha,
        es_laborable: false,
        bloquea_fichaje: true,
        motivo: "festivo",
        detalle: "Día no laborable según calendario",
      });
    }

    // 2️⃣ Ausencias aprobadas
    const aus = await sql`
      SELECT tipo
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
        AND estado = 'aprobado'
        AND fecha_inicio <= ${fecha}
        AND fecha_fin >= ${fecha}
      LIMIT 1
    `;

    if (aus.length) {
      return res.json({
        fecha,
        es_laborable: false,
        bloquea_fichaje: true,
        motivo: aus[0].tipo,
        detalle:
          aus[0].tipo === "vacaciones"
            ? "Vacaciones aprobadas"
            : "Baja médica aprobada",
      });
    }

    // 3️⃣ Día normal
    return res.json({
      fecha,
      es_laborable: true,
      bloquea_fichaje: false,
      motivo: null,
      detalle: null,
    });
  } catch (err) {
    console.error("❌ empleado calendario hoy:", err);
    res.status(500).json({ error: "Error calendario empleado" });
  }
};

export const getCalendarioEmpleadoRango = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    const { desde, hasta } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ error: "Rango requerido" });
    }

    // 1) Días base (festivos, no laborables, etc.)
    const dias = await sql`
      SELECT
        d.fecha,
        d.es_laborable,
        vc.tipo AS cal_tipo,
        vc.nombre AS cal_nombre,
        vc.fuente AS cal_fuente,
        a.tipo AS ausencia_tipo,
        a.estado AS ausencia_estado
      FROM v_dia_laborable_empresa_180 d
      LEFT JOIN v_calendario_empresa_180 vc
        ON vc.empresa_id = d.empresa_id
       AND vc.fecha = d.fecha
      LEFT JOIN ausencias_180 a
        ON a.empleado_id = ${empleado_id}
       AND a.estado = 'aprobado'
       AND d.fecha BETWEEN a.fecha_inicio AND a.fecha_fin
      WHERE d.empresa_id = ${empresa_id}
        AND d.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY d.fecha
    `;

    // 2) Jornadas reales
    const jornadas = await sql`
      SELECT
        j.id,
        j.fecha,
        j.inicio,
        j.fin,
        j.estado,
        j.resumen_json
      FROM jornadas_180 j
      WHERE j.empresa_id = ${empresa_id}
        AND j.empleado_id = ${empleado_id}
        AND j.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY j.fecha
    `;

    const eventos = [];

    // --- DÍAS: ausencias / festivos / no laborable
    for (const d of dias) {
      const fecha = String(d.fecha).slice(0, 10);

      if (d.ausencia_tipo) {
        eventos.push({
          id: `aus-${fecha}`,
          tipo: d.ausencia_tipo,
          title:
            d.ausencia_tipo === "vacaciones" ? "Vacaciones" : "Baja médica",
          start: fecha,
          allDay: true,
          estado: d.ausencia_estado,
          origen: "ausencia",
        });
        continue;
      }

      if (d.cal_tipo) {
        eventos.push({
          id: `cal-${d.cal_tipo}-${fecha}`,
          tipo: d.cal_tipo,
          title: titleForTipo(d.cal_tipo, d.cal_nombre),
          start: fecha,
          allDay: true,
          origen: "empresa",
        });
        continue;
      }

      if (d.es_laborable === false) {
        eventos.push({
          id: `nolaborable-${fecha}`,
          tipo: "no_laborable",
          title: "No laborable",
          start: fecha,
          allDay: true,
          origen: "sistema",
        });
      }
    }

    // --- JORNADAS: reales + bloques
    for (const j of jornadas) {
      if (!j.inicio || !j.fin) continue;

      const resumen = j.resumen_json || {};
      const bloquesReales = resumen.bloques_reales || [];

      // Evento resumen de jornada
      eventos.push({
        id: `jor-${j.id}`,
        tipo: "jornada",
        title: "Jornada",
        start: j.inicio,
        end: j.fin,
        allDay: false,
        estado: j.estado,
      });

      // Bloques reales
      for (let i = 0; i < bloquesReales.length; i++) {
        const b = bloquesReales[i];
        eventos.push({
          id: `real-${j.id}-${i}`,
          tipo: `real_${b.tipo}`,
          title: b.tipo === "trabajo" ? "Trabajo" : "Descanso",
          start: b.inicio,
          end: b.fin,
          allDay: false,
          origen: "real",
        });
      }

      // Bloques esperados (plan)
      const bloquesPlan = resumen.bloques_esperados || [];
      const fecha = j.fecha;

      for (let i = 0; i < bloquesPlan.length; i++) {
        const b = bloquesPlan[i];
        eventos.push({
          id: `plan-${j.id}-${i}`,
          tipo: `plan_${b.tipo}`,
          title: "Plan",
          start: `${fecha}T${b.inicio}`,
          end: `${fecha}T${b.fin}`,
          allDay: false,
          meta: { display: "background" },
          origen: "plan",
        });
      }
    }

    res.json(eventos);
  } catch (err) {
    console.error("❌ calendario empleado integrado:", err);
    res.status(500).json({ error: "Error calendario empleado" });
  }
};
// backend/src/services/jornadasService.js
