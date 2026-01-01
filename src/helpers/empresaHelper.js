import { sql } from "../db.js";

export async function obtenerEmpresaUsuario(userId) {
  // 1️⃣ Es dueño de empresa
  const empresa = await sql`
    SELECT id
    FROM empresa_180
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (empresa.length > 0) {
    return empresa[0].id;
  }

  // 2️⃣ Es empleado
  const empleado = await sql`
    SELECT empresa_id
    FROM employees_180
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (empleado.length > 0) {
    return empleado[0].empresa_id;
  }

  throw new Error("El usuario no pertenece a ninguna empresa");
}
