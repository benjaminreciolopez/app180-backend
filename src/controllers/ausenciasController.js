import { sql } from "../db.js";

export const aprobarVacaciones = async (req, res) => {
  try {
    const { id } = req.params;

    const update = await sql`
      UPDATE ausencias_180
      SET estado = 'aprobado'
      WHERE id = ${id} AND tipo = 'vacaciones'
      RETURNING *
    `;

    if (update.length === 0) {
      return res.status(400).json({ error: "Ausencia no encontrada" });
    }

    res.json({ success: true, ausencia: update[0] });
  } catch (err) {
    console.error("❌ Error en aprobarVacaciones:", err);
    res.status(500).json({ error: "Error al aprobar vacaciones" });
  }
};
export const rechazarVacaciones = async (req, res) => {
  try {
    const { id } = req.params;

    const update = await sql`
      UPDATE ausencias_180
      SET estado = 'rechazado'
      WHERE id = ${id} AND tipo = 'vacaciones'
      RETURNING *
    `;

    if (update.length === 0) {
      return res.status(400).json({ error: "Ausencia no encontrada" });
    }

    res.json({ success: true, ausencia: update[0] });
  } catch (err) {
    console.error("❌ Error en rechazarVacaciones:", err);
    res.status(500).json({ error: "Error al rechazar vacaciones" });
  }
};
export const crearBajaMedica = async (req, res) => {
  try {
    const { empleado_id, fecha_inicio, fecha_fin, motivo } = req.body;

    // Verificar que el admin es dueño de la empresa
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const aus = await sql`
      INSERT INTO ausencias_180 
      (empleado_id, empresa_id, tipo, fecha_inicio, fecha_fin, motivo, estado)
      VALUES (${empleado_id}, ${empresa[0].id}, 'baja_medica', ${fecha_inicio}, ${fecha_fin}, ${motivo}, 'aprobado')
      RETURNING *
    `;

    res.json({ success: true, ausencia: aus[0] });
  } catch (err) {
    console.error("❌ Error en crearBajaMedica:", err);
    res.status(500).json({ error: "Error al registrar baja médica" });
  }
};
// ausenciasController.js
export const listarAusenciasEmpresa = async (req, res) => {
  try {
    const { estado } = req.query; // <-- nuevo (opcional)

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const empresaId = empresa[0].id;

    const rows = await sql`
      SELECT a.*, e.nombre AS empleado_nombre
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresaId}
        AND (${estado}::text IS NULL OR a.estado = ${estado})
      ORDER BY a.creado_en DESC NULLS LAST, a.fecha_inicio DESC
      LIMIT 300
    `;

    return res.json(rows);
  } catch (err) {
    console.error("❌ Error en listarAusenciasEmpresa:", err);
    res.status(500).json({ error: "Error al obtener ausencias" });
  }
};

export const solicitarAusencia = async (req, res) => {
  try {
    const { empleado_id, empresa_id } = req.user;
    const { tipo, fecha_inicio, fecha_fin, comentario } = req.body;

    if (!["vacaciones", "baja_medica"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo de ausencia no válido" });
    }

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

export const misAusencias = async (req, res) => {
  try {
    const { empleado_id } = req.user;
    if (!empleado_id) return res.status(403).json({ error: "No autorizado" });

    const rows = await sql`
      SELECT id, tipo, fecha_inicio, fecha_fin, estado, comentario_empleado
      FROM ausencias_180
      WHERE empleado_id = ${empleado_id}
      ORDER BY creado_en DESC
      LIMIT 200
    `;
    res.json(rows);
  } catch (e) {
    console.error("❌ misAusencias", e);
    res.status(500).json({ error: "Error obteniendo ausencias" });
  }
};
export const actualizarEstadoAusencia = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, comentario_admin } = req.body;

    if (!["pendiente", "aprobado", "rechazado"].includes(estado)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa.length)
      return res.status(403).json({ error: "No autorizado" });

    const empresaId = empresa[0].id;

    const rows = await sql`
      UPDATE ausencias_180
      SET
        estado = ${estado},
        comentario_admin = COALESCE(${comentario_admin}::text, comentario_admin)
      WHERE id = ${id}
        AND empresa_id = ${empresaId}
      RETURNING *
    `;

    if (!rows.length)
      return res.status(404).json({ error: "Ausencia no encontrada" });

    res.json({ success: true, ausencia: rows[0] });
  } catch (err) {
    console.error("❌ actualizarEstadoAusencia:", err);
    res.status(500).json({ error: "Error actualizando estado" });
  }
};
export const crearAusenciaAdmin = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { empleado_id, tipo, fecha_inicio, fecha_fin, comentario_admin } =
      req.body;

    if (!empleado_id || !tipo || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "empleado_id, tipo, fecha_inicio y fecha_fin son obligatorios",
      });
    }

    if (!["vacaciones", "baja_medica"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo no válido" });
    }

    if (fecha_inicio > fecha_fin) {
      return res
        .status(400)
        .json({ error: "La fecha de inicio no puede ser mayor que la de fin" });
    }

    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;
    if (!empresa.length) {
      return res.status(403).json({ error: "Empresa no encontrada" });
    }
    const empresaId = empresa[0].id;

    // Validar que el empleado pertenece a la empresa
    const emp = await sql`
      SELECT id FROM employees_180
      WHERE id = ${empleado_id}
        AND empresa_id = ${empresaId}
      LIMIT 1
    `;
    if (!emp.length) {
      return res
        .status(400)
        .json({ error: "Empleado no pertenece a tu empresa" });
    }

    const rows = await sql`
      INSERT INTO ausencias_180 (
        empleado_id,
        empresa_id,
        tipo,
        fecha_inicio,
        fecha_fin,
        comentario_admin,
        estado
      ) VALUES (
        ${empleado_id},
        ${empresaId},
        ${tipo},
        ${fecha_inicio},
        ${fecha_fin},
        ${comentario_admin || null},
        'aprobado'
      )
      RETURNING *
    `;

    return res.json({ success: true, ausencia: rows[0] });
  } catch (err) {
    console.error("❌ crearAusenciaAdmin:", err);
    return res.status(500).json({ error: "Error creando ausencia" });
  }
};
