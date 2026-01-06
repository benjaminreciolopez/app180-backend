// src/controllers/empleadoCalendarioController.js
import { sql } from "../db.js";

function today() {
  return new Date().toISOString().slice(0, 10);
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

    const dias = await sql`
      SELECT
        d.fecha,
        d.es_laborable,
        a.tipo AS ausencia_tipo,
        a.estado
      FROM v_dia_laborable_empresa_180 d
      LEFT JOIN ausencias_180 a
        ON a.empleado_id = ${empleado_id}
       AND a.estado = 'aprobado'
       AND d.fecha BETWEEN a.fecha_inicio AND a.fecha_fin
      WHERE d.empresa_id = ${empresa_id}
        AND d.fecha BETWEEN ${desde} AND ${hasta}
      ORDER BY d.fecha
    `;

    res.json(dias);
  } catch (err) {
    console.error("❌ calendario empleado rango:", err);
    res.status(500).json({ error: "Error calendario empleado" });
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
