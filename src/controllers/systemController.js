import { sql } from "../db.js";

export async function getSystemStatus(req, res) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM empresa_180
  `;

  const total = rows[0].total;

  const initialized = total > 0;

  res.json({
    initialized, // true si ya hay empresa
    hasCompany: initialized, // alias
    bootstrap: !initialized, // 👈 CLAVE: invertido
  });
}
