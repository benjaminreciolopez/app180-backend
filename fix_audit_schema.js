import { sql } from "./src/db.js";

async function fix() {
    try {
        console.log("Cambiando tipo de columna entidad_id a VARCHAR...");
        await sql`
      ALTER TABLE audit_log_180 
      ALTER COLUMN entidad_id TYPE VARCHAR(255);
    `;
        console.log("✅ Columna cambiada con éxito.");
    } catch (err) {
        console.error("❌ Error al cambiar columna:", err);
    } finally {
        process.exit();
    }
}

fix();
