// src/services/ensureSelfEmployee.js
import { sql } from "../db.js";

/**
 * Garantiza que un admin tenga un empleado asociado (empleado lógico).
 * Útil para autónomos sin empleados.
 */
export async function ensureSelfEmployee({ userId, empresaId, nombre }) {
  const existing = await sql`
    SELECT id
    FROM employees_180
    WHERE user_id = ${userId}
      AND empresa_id = ${empresaId}
    LIMIT 1
  `;
  if (existing.length > 0) return existing[0].id;

  const created = await sql`
    INSERT INTO employees_180 (user_id, empresa_id, nombre, activo, tipo_trabajo, created_at)
    VALUES (${userId}, ${empresaId}, ${
    nombre || "Autónomo"
  }, true, 'autonomo', now())
    RETURNING id
  `;
  return created[0].id;
}
