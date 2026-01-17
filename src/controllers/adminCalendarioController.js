// src/controllers/adminCalendarioController.js
import { sql } from "../db.js";
import { ensureFestivosForYear } from "../services/festivosNagerService.js";

export const getCalendarioAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { desde, hasta, empleado_id } = req.query;

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa.length) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }

    const empresaId = empresa[0].id;

    const rows = await sql`
      SELECT
        d.fecha,
        d.es_laborable,
        a.empleado_id,
        a.tipo AS ausencia_tipo,
        a.estado AS ausencia_estado
      FROM v_dia_laborable_empresa_180 d
      LEFT JOIN ausencias_180 a
        ON a.empresa_id = ${empresaId}
       AND a.estado = 'aprobado'
       AND d.fecha BETWEEN a.fecha_inicio AND a.fecha_fin
       AND (${empleado_id}::uuid IS NULL OR a.empleado_id = ${empleado_id})
      WHERE d.empresa_id = ${empresaId}
        AND d.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY d.fecha
    `;

    res.json(rows);
  } catch (err) {
    console.error("❌ calendario admin eventos:", err);
    return res.status(500).json({
      error: "Error calendario admin",
      detail: err.message,
      stack: err.stack,
    });
  }
};

export const solicitarAusencia = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    const { tipo, fecha_inicio, fecha_fin, comentario } = req.body;

    const rows = await sql`
      INSERT INTO ausencias_180 (
        empleado_id,
        empresa_id,
        tipo,
        fecha_inicio,
        fecha_fin,
        comentario_empleado,
        estado
      ) VALUES (
        ${empleado_id},
        ${empresa_id},
        ${tipo},
        ${fecha_inicio},
        ${fecha_fin},
        ${comentario || null},
        'pendiente'
      )
      RETURNING *
    `;

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ solicitar ausencia:", err);
    res.status(500).json({ error: "Error solicitando ausencia" });
  }
};

// adminCalendarioController.js
export const getEventosCalendarioAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { desde, hasta, empleado_id } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ error: "Rango requerido" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa.length) {
      return res.status(400).json({ error: "Empresa no encontrada" });
    }
    const empresaId = empresa[0].id;

    const empleadoIdSafe =
      empleado_id && empleado_id !== "" ? empleado_id : null;

    // 1) Ausencias
    const ausencias = await sql`
      SELECT
        a.id,
        a.empleado_id,
        e.nombre AS empleado_nombre,
        a.tipo,
        a.estado,
        a.fecha_inicio AS start,
        a.fecha_fin AS end
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND a.fecha_fin >= ${desde}
        AND a.fecha_inicio <= ${hasta}
        AND (${empleadoIdSafe} IS NULL OR a.empleado_id = ${empleadoIdSafe})
      ORDER BY a.fecha_inicio
    `;

    // 2) Jornadas
    const jornadas = await sql`
      SELECT
        j.id,
        j.empleado_id,
        e.nombre AS empleado_nombre,
        j.fecha,
        j.inicio,
        j.fin,
        j.estado,
        j.resumen_json
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.empresa_id = ${empresaId}
        AND j.fecha BETWEEN ${desde} AND ${hasta}
        AND (${empleadoIdSafe} IS NULL OR j.empleado_id = ${empleadoIdSafe})
      ORDER BY j.fecha
    `;

    const eventos = [];

    // Ausencias
    for (const a of ausencias) {
      eventos.push({
        id: `aus-${a.id}`,
        tipo: a.tipo,
        title: `${a.empleado_nombre}: ${a.tipo}`,
        start: a.start,
        end: a.end,
        allDay: true,
        estado: a.estado,
      });
    }

    // Jornadas + bloques
    for (const j of jornadas) {
      if (!j.inicio || !j.fin) continue;

      const resumen = j.resumen_json || {};
      const bloquesReales = resumen.bloques_reales || [];
      const bloquesPlan = resumen.bloques_esperados || [];

      eventos.push({
        id: `jor-${j.id}`,
        tipo: "jornada",
        title: `${j.empleado_nombre}`,
        start: j.inicio,
        end: j.fin,
        allDay: false,
        estado: j.estado,
      });

      for (let i = 0; i < bloquesReales.length; i++) {
        const b = bloquesReales[i];
        eventos.push({
          id: `real-${j.id}-${i}`,
          tipo: b.tipo,
          title: `${j.empleado_nombre}: ${b.tipo}`,
          start: b.inicio,
          end: b.fin,
          allDay: false,
        });
      }

      const fecha = j.fecha;

      for (let i = 0; i < bloquesPlan.length; i++) {
        const b = bloquesPlan[i];
        eventos.push({
          id: `plan-${j.id}-${i}`,
          tipo: "plan_" + b.tipo,
          title: `Plan ${j.empleado_nombre}`,
          start: `${fecha}T${b.inicio}`,
          end: `${fecha}T${b.fin}`,
          allDay: false,
          display: "background",
        });
      }
    }

    res.json(eventos);
  } catch (err) {
    console.error("❌ calendario admin integrado:", err);
    res.status(500).json({ error: "Error calendario admin" });
  }
};

export async function importarFestivosNager(req, res) {
  try {
    const year = Number(req.params.year);
    const r = await ensureFestivosForYear(year);

    return res.json({
      ok: true,
      year: r.year,
      imported: r.imported,
      count: r.count,
    });
  } catch (e) {
    console.error("❌ importarFestivosNager:", e);
    return res.status(500).json({ error: "Error importando festivos" });
  }
}
