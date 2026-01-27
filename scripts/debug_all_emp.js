
import { sql } from "../src/db.js";
import { config } from "dotenv";

config();

async function main() {
  try {
    const empleados = await sql`
      SELECT e.id, e.nombre, COUNT(a.id) as num_asignaciones
      FROM employees_180 e
      LEFT JOIN asignaciones_plantilla_jornada_180 a ON a.empleado_id = e.id
      GROUP BY e.id, e.nombre
    `;

    console.table(empleados);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
