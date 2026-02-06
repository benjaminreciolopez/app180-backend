
import { sql } from "../db.js";

/**
 * Obtiene el ID de la empresa asociada al usuario administrador.
 * Lanza un error si no se encuentra.
 */
export async function getEmpresaIdAdminOrThrow(userId) {
  const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
  const empresaId = r[0]?.id ?? null;
  if (!empresaId) {
    const err = new Error("Empresa no asociada al usuario");
    err.status = 403;
    throw err;
  }
  return empresaId;
}
