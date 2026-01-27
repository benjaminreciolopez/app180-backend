
import { sql } from "../src/db.js";
import { config } from "dotenv";

config();

async function main() {
  try {
    // 1. Empleado
    const empleados = await sql`
      SELECT id, nombre, cliente_defecto_id 
      FROM employees_180 
      WHERE nombre ILIKE '%Empleado 1%'
      LIMIT 1
    `;

    if (!empleados.length) {
      console.log("No se encontró empleado");
      process.exit(0);
    }
    const emp = empleados[0];
    console.log("Empleado:", emp);

    // 2. Asignaciones históricas
    console.log("\n---- Asignaciones Plantilla ----");
    const asigs = await sql`
        SELECT * FROM asignaciones_plantilla_jornada_180 
        WHERE empleado_id = ${emp.id}
        ORDER BY created_at DESC
    `;
    console.table(asigs);

    // 5. Jornadas 180 (Hoy)
    console.log("\n---- Jornadas 180 (Hoy) ----");
    const hoy = new Date().toISOString().slice(0, 10);
    const jornadas = await sql`
        SELECT * FROM jornadas_180 
        WHERE empleado_id = ${emp.id}
          AND fecha = ${hoy}
    `;
    console.table(jornadas);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
