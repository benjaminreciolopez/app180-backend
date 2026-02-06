import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.SUPABASE_URL || 'postgresql://postgres.qexnthgfdvtvwoeykgun:jNi2WTw191rLPNb4@aws-0-eu-west-3.pooler.supabase.com:5432/postgres');

async function run() {
    try {
        await sql`ALTER TABLE configuracionsistema_180 ADD COLUMN IF NOT EXISTS storage_facturas_folder TEXT DEFAULT 'Facturas emitidas'`;
        console.log('✅ Columna storage_facturas_folder añadida o ya existía.');
    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        process.exit(0);
    }
}

run();
