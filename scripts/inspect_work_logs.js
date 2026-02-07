import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function inspectWorkLogs() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        console.log(`\n--- SCHEMA OF work_logs_180 ---`);
        const res = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'work_logs_180'
            ORDER BY ordinal_position
        `);
        console.table(res.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectWorkLogs();
