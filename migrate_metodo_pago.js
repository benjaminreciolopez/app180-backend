import { sql } from "./src/db.js";

async function migrate() {
    try {
        console.log("🚀 Iniciando migración de base de datos...");

        // Añadir metodo_pago a factura_180
        await sql`ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50) DEFAULT 'TRANSFERENCIA'`;
        console.log("✅ Columna 'metodo_pago' añadida a 'factura_180'");

        console.log("🎉 Migración completada con éxito");
    } catch (err) {
        console.error("❌ Error en migración:", err);
    } finally {
        process.exit();
    }
}

migrate();
