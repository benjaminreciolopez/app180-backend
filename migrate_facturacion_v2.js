import { sql } from './src/db.js';
async function run() {
    try {
        console.log("Checking and adding ALL missing columns to emisor_180...");
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS nombre TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS nif TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS direccion TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS poblacion TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS provincia TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS cp TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'España'`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS telefono TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS email TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS web TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS registro_mercantil TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS iban TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS logo_path TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS terminos_legales TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_pie TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_exento TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_rectificativa TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS certificado_path TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS certificado_upload_date TIMESTAMP WITH TIME ZONE`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS certificado_info JSONB`;

        console.log("Checking and adding columns to configuracionsistema_180...");
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS verifactu_activo BOOLEAN DEFAULT false`;
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS verifactu_modo TEXT DEFAULT 'TEST'`;
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS numeracion_tipo TEXT DEFAULT 'STANDARD'`;
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS ticket_bai_activo BOOLEAN DEFAULT false`;

        console.log("✅ Database schema synchronized successfully");
        process.exit(0);
    } catch (e) {
        console.error("❌ Migration error:", e);
        process.exit(1);
    }
}
run();
