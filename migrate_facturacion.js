import { sql } from './src/db.js';
async function run() {
    try {
        console.log("Checking and adding missing columns...");
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS telefono TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS web TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_pie TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_exento TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS texto_rectificativa TEXT`;
        await sql`ALTER TABLE emisor_180 ADD COLUMN IF NOT EXISTS certificado_info JSONB`;
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS numeracion_tipo TEXT DEFAULT 'STANDARD'`;
        console.log("✅ Database columns updated successfully");
        process.exit(0);
    } catch (e) {
        console.error("❌ Migration error:", e);
        process.exit(1);
    }
}
run();
