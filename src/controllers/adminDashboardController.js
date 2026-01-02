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
    // =========================
    // 1) CONTADORES BÁSICOS
    // =========================

    // empleados activos
    const [empleadosActivosRow] = await sql`
      SELECT COUNT(*)::int AS count
      FROM employees_180
      WHERE activo = true
    `;
    const empleadosActivos = empleadosActivosRow?.count ?? 0;

    // fichajes de hoy
    const [fichajesHoyRow] = await sql`
      SELECT COUNT(*)::int AS count
      FROM fichajes_180
      WHERE DATE(created_at) = CURRENT_DATE
    `;
    const fichajesHoy = fichajesHoyRow?.count ?? 0;

    // sospechosos de hoy
    const [sospechososHoyRow] = await sql`
      SELECT COUNT(*)::int AS count
      FROM fichajes_180
      WHERE sospechoso = true
      AND DATE(created_at) = CURRENT_DATE
    `;
    const sospechososHoy = sospechososHoyRow?.count ?? 0;

    // =========================
    // 2) EMPLEADOS FICHANDO AHORA
    // =========================
    const trabajandoAhora = await sql`
      WITH ultimos AS (
        SELECT
          f.*,
          ROW_NUMBER() OVER (
            PARTITION BY f.empleado_id
            ORDER BY f.created_at DESC
          ) AS rn
        FROM fichajes_180 f
      )
      SELECT
        u.id,
        u.empleado_id,
        u.cliente_id,
        u.estado,
        u.created_at AS desde,
        e.nombre AS empleado_nombre,
        c.nombre AS cliente_nombre
      FROM ultimos u
      JOIN employees_180 e ON e.id = u.empleado_id
      LEFT JOIN clients_180 c ON c.id = u.cliente_id
      WHERE u.rn = 1
      AND u.estado = 'ENTRADA'
      ORDER BY u.created_at DESC
      LIMIT 20
    `;

    // =========================
    // 3) ÚLTIMOS FICHAJES
    // =========================
    const ultimosFichajes = await sql`
      SELECT
        f.id,
        f.empleado_id,
        f.cliente_id,
        f.estado,
        f.created_at,
        e.nombre AS empleado_nombre,
        c.nombre AS cliente_nombre
      FROM fichajes_180 f
      JOIN employees_180 e ON e.id = f.empleado_id
      LEFT JOIN clients_180 c ON c.id = f.cliente_id
      ORDER BY f.created_at DESC
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
    console.error("❌ Error en getAdminDashboard:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener datos del dashboard" });
  }
};
