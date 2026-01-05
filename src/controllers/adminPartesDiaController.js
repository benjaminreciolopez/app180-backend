// src/controllers/adminPartesDiaController.js
import { sql } from "../db.js";

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const adminPartesDia = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });

    const empresaId = user.empresa_id;
    if (!empresaId)
      return res.status(400).json({ error: "Admin sin empresa_id" });

    const fecha = (req.query.fecha || todayYYYYMMDD()).toString();

    const rows = await sql`
      SELECT
        r.empleado_id,
        e.nombre AS empleado_nombre,
        r.fecha,
        r.estado,
        r.resumen,
        r.horas_trabajadas,
        r.cliente_id,
        c.nombre AS cliente_nombre
      FROM employee_daily_report_180 r
      JOIN employees_180 e ON e.id = r.empleado_id
      LEFT JOIN clients_180 c ON c.id = r.cliente_id
      WHERE r.empresa_id = ${empresaId}
        AND r.fecha = ${fecha}::date
      ORDER BY e.nombre ASC
    `;

    return res.json({ fecha, items: rows });
  } catch (err) {
    console.error("❌ adminPartesDia:", err);
    return res.status(500).json({ error: "Error cargando partes del día" });
  }
};
