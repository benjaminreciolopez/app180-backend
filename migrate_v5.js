import { sql } from "./src/db.js";

async function run() {
  console.log("Iniciando migración V5...");
  try {
    await sql`
      ALTER TABLE empleado_plantillas_180
      ADD COLUMN IF NOT EXISTS alias text DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS color text DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS ignorar_festivos boolean DEFAULT false
    `;
    console.log("✅ Tablas actualizadas correctamente");
    process.exit(0);
  } catch (e) {
    console.error("❌ Error migración:", e);
    process.exit(1);
  }
}

run();
