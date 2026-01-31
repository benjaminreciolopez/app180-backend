import { sql } from "./src/db.js";

async function migrate() {
  try {
    console.log("🚀 Iniciando migración V6: Add invite code...");

    // Add code column if not exists
    await sql`
      ALTER TABLE invite_180 
      ADD COLUMN IF NOT EXISTS code VARCHAR(20) DEFAULT NULL;
    `;

    // Create index for fast lookup
    await sql`
      CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_180(code);
    `;

    console.log("✅ Migración V6 completada con éxito");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error en migración:", err);
    process.exit(1);
  }
}

migrate();
