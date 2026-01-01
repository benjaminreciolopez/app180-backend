import { sql } from "../db.js";

export const solicitarVacaciones = async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, motivo } = req.body;

    const empleado = await sql`
      SELECT id, empresa_id FROM employees_180
      WHERE user_id = ${req.user.id}
    `;

    if (empleado.length === 0) {
      return res
        .status(400)
        .json({ error: "Solo empleados pueden solicitar vacaciones" });
    }

    const emp = empleado[0];

    const ausencia = await sql`
      INSERT INTO ausencias_180
      (empleado_id, empresa_id, tipo, fecha_inicio, fecha_fin, motivo, estado)
      VALUES (${emp.id}, ${emp.empresa_id}, 'vacaciones', ${fecha_inicio}, ${fecha_fin}, ${motivo}, 'pendiente')
      RETURNING *
    `;

    return res.json({ success: true, ausencia: ausencia[0] });
  } catch (err) {
    console.error("❌ Error en solicitarVacaciones:", err);
    res.status(500).json({ error: "Error al solicitar vacaciones" });
  }
};
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
export const listarAusenciasEmpresa = async (req, res) => {
  try {
    const empresa = await sql`
      SELECT id FROM empresa_180 WHERE user_id = ${req.user.id}
    `;

    if (empresa.length === 0) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const rows = await sql`
      SELECT a.*, e.nombre AS empleado_nombre
      FROM ausencias_180 a
      JOIN employees_180 e ON e.id = a.empleado_id
      WHERE a.empresa_id = ${empresa[0].id}
      ORDER BY a.fecha_inicio DESC
    `;

    return res.json(rows);
  } catch (err) {
    console.error("❌ Error en listarAusenciasEmpresa:", err);
    res.status(500).json({ error: "Error al obtener ausencias" });
  }
};
