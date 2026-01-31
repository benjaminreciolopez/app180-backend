import { sql } from "./src/db.js";

async function run() {
  try {
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'empleado_plantillas_180'
    `;
    console.log("Columns:", cols);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
