
import { sql } from '../src/db.js';

async function run() {
  try {
    console.log("Relaxing constraints on plantilla_dias_180...");

    await sql`
      ALTER TABLE plantilla_dias_180 
      ALTER COLUMN hora_inicio DROP NOT NULL;
    `;
    console.log("✅ hora_inicio is now nullable");

    await sql`
      ALTER TABLE plantilla_dias_180 
      ALTER COLUMN hora_fin DROP NOT NULL;
    `;
    console.log("✅ hora_fin is now nullable");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error relaxing constraints:", err);
    process.exit(1);
  }
}

run();
