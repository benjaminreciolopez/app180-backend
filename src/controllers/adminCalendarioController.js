// src/controllers/adminCalendarioController.js
import { sql } from "../db.js";

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
    console.error("❌ calendario admin:", err);
    res.status(500).json({ error: "Error calendario admin" });
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
