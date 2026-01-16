// backend/src/controllers/adminJornadasController.js

import { sql } from "../db.js";

export const getAdminJornadas = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id} LIMIT 1
    `;
    if (!empresa.length)
      return res.status(400).json({ error: "Empresa no encontrada" });
    const empresaId = empresa[0].id;

    const { empleado_id, fecha } = req.query;
    // fecha = "YYYY-MM-DD" opcional

    // 1) Jornadas base
    const jornadas = await sql`
      SELECT
        j.id AS jornada_id,
        j.empleado_id,
        e.nombre AS empleado_nombre,
        j.inicio,
        j.fin,
        j.estado,
        j.incidencia
      FROM jornadas_180 j
      JOIN employees_180 e ON e.id = j.empleado_id
      WHERE j.empresa_id = ${empresaId}
        AND (${
          empleado_id || null
        }::uuid IS NULL OR j.empleado_id = ${empleado_id})
        AND (${fecha || null}::text IS NULL OR (j.inicio::date = ${fecha}))
      ORDER BY j.inicio DESC
      LIMIT 200
    `;

    if (!jornadas.length) return res.json([]);

    const jornadaIds = jornadas.map((j) => j.jornada_id);

    // 2) Movimientos de esas jornadas
    const movs = await sql`
      SELECT
        f.id,
        f.jornada_id,
        f.tipo,
        f.fecha,
        f.sospechoso,
        f.nota,
        f.direccion,
        f.ciudad,
        f.pais
      FROM fichajes_180 f
      WHERE f.empresa_id = ${empresaId}
        AND f.jornada_id = ANY(${jornadaIds})
      ORDER BY f.fecha ASC
    `;

    // index por jornada
    const byJ = new Map();
    for (const j of jornadas) {
      byJ.set(j.jornada_id, {
        ...j,
        movimientos: [],
      });
    }

    for (const m of movs) {
      const j = byJ.get(m.jornada_id);
      if (!j) continue;

      const ubicacion =
        [m.direccion, m.ciudad, m.pais].filter(Boolean).join(" · ") || null;

      j.movimientos.push({
        id: m.id,
        tipo: m.tipo,
        fecha: m.fecha,
        sospechoso: m.sospechoso,
        nota: m.nota,
        ubicacion,
        direccion: m.direccion,
        ciudad: m.ciudad,
        pais: m.pais,
      });
    }

    return res.json(Array.from(byJ.values()));
  } catch (err) {
    console.error("❌ Error getAdminJornadas:", err);
    return res.status(500).json({ error: "Error obteniendo jornadas" });
  }
};
