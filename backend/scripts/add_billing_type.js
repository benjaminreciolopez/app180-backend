import { sql } from "../src/db.js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function main() {
    console.log("🚀 Iniciando migración de columna tipo_facturacion...");

    try {
        await sql`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='work_logs_180' AND column_name='tipo_facturacion') THEN 
                    ALTER TABLE work_logs_180 ADD COLUMN tipo_facturacion TEXT DEFAULT 'hora'; 
                END IF; 
            END $$;
        `;
        console.log("✅ Columna tipo_facturacion verificada/creada");
    } catch (e) {
        console.error("❌ Error migrando DB:", e);
    }
    process.exit(0);
}

main();
