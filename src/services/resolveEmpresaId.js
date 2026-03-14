import { sql } from "../db.js";

/**
 * Resuelve empresa_id del usuario autenticado.
 * Prioriza req.user.empresa_id (ya resuelto por authMiddleware para asesores),
 * y solo consulta empresa_180 como fallback para admins directos.
 */
export async function resolveEmpresaId(req) {
  if (req.user.empresa_id) {
    return req.user.empresa_id;
  }

  const rows = await sql`
    SELECT id FROM empresa_180 WHERE user_id = ${req.user.id} LIMIT 1
  `;

  if (rows.length === 0) return null;

  return rows[0].id;
}
