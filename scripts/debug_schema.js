
import { sql } from "../src/db.js";
import { config } from "dotenv";

config();

async function main() {
  try {
    // Columnas
    console.log("--- Columnas empleado_plantillas_180 ---");
    const c1 = await sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'empleado_plantillas_180'
    `;
    console.table(c1);

    console.log("--- Columnas asignaciones_plantilla_jornada_180 ---");
    const c2 = await sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'asignaciones_plantilla_jornada_180'
    `;
    console.table(c2);

    // Conteo
    const count1 = await sql`SELECT count(*) FROM empleado_plantillas_180`;
    console.log("Count empleado_plantillas_180:", count1[0].count);

    const count2 = await sql`SELECT count(*) FROM asignaciones_plantilla_jornada_180`;
    console.log("Count asignaciones_plantilla_jornada_180:", count2[0].count);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
