// src/controllers/adminDashboardController.js
import { sql } from "../db.js";

/**
 * Dashboard admin:
 * - empleadosActivos
 * - fichajesHoy
 * - sospechososHoy
 * - trabajandoAhora: empleados cuya ÚLTIMA marca es ENTRADA
 * - ultimosFichajes: últimos 10 fichajes
 */
export const getAdminDashboard = async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ error: "Admin sin empresa asignada" });
    }

    // =========================
    // 1️⃣ CONTADORES
    // =========================

    const [{ count: empleadosActivos = 0 }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM employees_180
      WHERE empresa_id = ${empresaId}
        AND activo = true
    `;

    const [{ count: fichajesHoy = 0 }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND fecha::date = CURRENT_DATE
    `;

    const [{ count: sospechososHoy = 0 }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM fichajes_180
      WHERE empresa_id = ${empresaId}
        AND sospechoso = true
        AND fecha::date = CURRENT_DATE
    `;

    // =========================
    // 2️⃣ TRABAJANDO AHORA
    // =========================
    const trabajandoAhora = await sql`
      WITH ultimos AS (
        SELECT
          f.*,
          ROW_NUMBER() OVER (
            PARTITION BY f.empleado_id
            ORDER BY f.fecha DESC
          ) AS rn
        FROM fichajes_180 f
        WHERE f.empresa_id = ${empresaId}
      )
      SELECT
        u.empleado_id,
        u.fecha AS desde,
        e.nombre AS empleado_nombre
      FROM ultimos u
      JOIN employees_180 e ON e.id = u.empleado_id
      WHERE u.rn = 1
        AND u.tipo = 'entrada'
      ORDER BY u.fecha DESC
      LIMIT 20
    `;

    // =========================
    // 3️⃣ ÚLTIMOS FICHAJES
    // =========================
    const ultimosFichajes = await sql`
      SELECT
        f.id,
        f.tipo,
        f.fecha,
        e.nombre AS empleado_nombre
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      WHERE f.empresa_id = ${empresaId}
      ORDER BY f.fecha DESC
      LIMIT 10
    `;

    return res.json({
      empleadosActivos,
      fichajesHoy,
      sospechososHoy,
      trabajandoAhora,
      ultimosFichajes,
    });
  } catch (err) {
    console.error("❌ getAdminDashboard:", err);
    return res.status(500).json({ error: "Error en dashboard admin" });
  }
};
