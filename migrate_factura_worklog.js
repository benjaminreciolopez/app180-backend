import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function run() {
    try {
        await sql`ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS work_log_id UUID REFERENCES work_logs_180(id)`;
        console.log('Column work_log_id added to factura_180');
    } catch (e) {
        console.error(e);
    } finally {
        await sql.end();
    }
}

run();
