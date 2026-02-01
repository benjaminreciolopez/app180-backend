import { sql } from './src/db.js';
async function run() {
    try {
        console.log("Fixing column types for base64 storage...");
        // Cambiar logo_path y certificado_path a TEXT para que acepten strings largos (Base64)
        await sql`ALTER TABLE emisor_180 ALTER COLUMN logo_path TYPE TEXT`;
        await sql`ALTER TABLE emisor_180 ALTER COLUMN certificado_path TYPE TEXT`;
        // Asegurar que certificado_info sea JSONB
        await sql`ALTER TABLE emisor_180 ALTER COLUMN certificado_info TYPE JSONB USING certificado_info::jsonb`;

        // Añadir columna para contraseña del certificado si no existe
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS certificado_password TEXT`;

        console.log("✅ Database types updated successfully");
        process.exit(0);
    } catch (e) {
        console.error("❌ Migration error:", e);
        process.exit(1);
    }
}
run();
