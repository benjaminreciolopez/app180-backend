import { sql } from "../db.js";
import { ensureSelfEmployee } from "./ensureSelfEmployee.js";

/**
 * Si la empresa es autónoma y no tiene empleados activos, crea automáticamente
 * un registro de empleado-dueño usando el user_id propietario de la empresa.
 * Idempotente: si ya hay empleados, no hace nada.
 *
 * Wrapper sobre ensureSelfEmployee que añade la mirada empresa-céntrica:
 * - Sólo dispara si tipo_contribuyente='autonomo'.
 * - Sólo dispara si la empresa no tiene aún empleados activos.
 *
 * Se llama tanto desde el modo empresa (getEmployeesAdmin, etc.) como desde
 * el modo asesoría (getClienteResumen) para mantener consistencia entre modos.
 */
export async function ensureAutonomoOwnerEmployee(empresaId) {
  if (!empresaId) return false;

  const [empresa] = await sql`
    SELECT id, nombre, tipo_contribuyente, user_id
    FROM empresa_180
    WHERE id = ${empresaId}
    LIMIT 1
  `;

  if (!empresa || empresa.tipo_contribuyente !== "autonomo" || !empresa.user_id) {
    return false;
  }

  const [empleadosCheck] = await sql`
    SELECT COUNT(*)::int AS total
    FROM employees_180
    WHERE empresa_id = ${empresaId} AND activo = true
  `;

  if (empleadosCheck.total > 0) return false;

  await ensureSelfEmployee({
    userId: empresa.user_id,
    empresaId,
    nombre: empresa.nombre || "Autónomo",
  });

  return true;
}
