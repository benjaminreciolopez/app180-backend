import { sql } from "../db.js";

export async function getSystemStatus(req, res) {
  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM empresa_180
  `;

  const total = rows[0].total;

  const initialized = total > 0;

  res.json({
    initialized, // claro
    hasCompany: initialized,
    bootstrap: initialized, // 👈 CLAVE: mismo significado
  });
}
