import { sql } from "../src/db.js";

async function runMigration() {
    try {
        console.log("Applying migration 003_add_mobile_modules.sql...");

        await sql`
      ALTER TABLE empresa_config_180 
      ADD COLUMN IF NOT EXISTS modulos_mobile JSONB DEFAULT NULL;
    `;

        console.log("✅ Migration applied successfully!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    }
}

runMigration();
