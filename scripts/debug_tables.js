
import { sql } from "../src/db.js";
import { config } from "dotenv";

config();

async function main() {
  try {
    const empleados = await sql`
      SELECT id FROM employees_180 WHERE nombre ILIKE '%Empleado 1%' LIMIT 1
    `;
    const empId = empleados[0]?.id;

    if (!empId) {
        console.log("No Empleado 1");
        process.exit(0);
    }

    console.log("--- empleado_plantillas_180 (Donde escribe el controller) ---");
    const t1 = await sql`SELECT * FROM empleado_plantillas_180 WHERE empleado_id=${empId}`;
    console.table(t1);

    console.log("\n--- asignaciones_plantilla_jornada_180 (Donde lee el resolver) ---");
    try {
        const t2 = await sql`SELECT * FROM asignaciones_plantilla_jornada_180 WHERE empleado_id=${empId}`;
        console.table(t2);
    } catch (e) {
        console.log("Error leyendo asignaciones_plantilla_jornada_180:", e.message);
    }

    // Check types
    console.log("\n--- Table Types ---");
    const tables = await sql`
        SELECT table_name, table_type 
        FROM information_schema.tables 
        WHERE table_name IN ('empleado_plantillas_180', 'asignaciones_plantilla_jornada_180')
    `;
    console.table(tables);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
