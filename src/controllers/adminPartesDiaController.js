import { sql } from "../db.js";

export async function getPartesDia(req, res) {
  try {
    const { fecha } = req.query;
    if (!fecha) {
      return res.status(400).json({ error: "Fecha requerida" });
    }

    const empresaId = req.user.empresa_id;

    const items = await sql`
      SELECT 
        pd.*, 
        e.nombre as empleado_nombre,
        c.nombre as cliente_nombre
      FROM partes_dia_180 pd
      JOIN employees_180 e ON pd.empleado_id = e.id
      LEFT JOIN clients_180 c ON pd.cliente_id = c.id
      WHERE pd.empresa_id = ${empresaId}
      AND pd.fecha = ${fecha}
      ORDER BY e.nombre
    `;

    res.json({ items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo partes del día" });
  }
}

export async function validarParte(req, res) {
  try {
    const { empleado_id, fecha, validado, nota_admin } = req.body;
    const empresaId = req.user.empresa_id;

    await sql`
      UPDATE partes_dia_180
      SET 
        validado = ${validado},
        nota_admin = ${nota_admin || null},
        validado_at = now()
      WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleado_id}
      AND fecha = ${fecha}
    `;

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error validando parte" });
  }
}
