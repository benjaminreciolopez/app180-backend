import { sql } from "../db.js";

export async function getSystemStatus(req, res) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM empresa_180
  `;

  const total = rows[0].total;

  res.json({
    hasCompany: total > 0,
    bootstrap: total === 0,
  });
}
