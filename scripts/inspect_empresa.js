import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function inspectEmpresa() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        console.log(`\n--- COLUMNS OF empresa_180 ---`);
        const res = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'empresa_180'
            ORDER BY ordinal_position
        `);
        console.table(res.rows);

        const data = await client.query('SELECT * FROM empresa_180 LIMIT 10');
        console.log('\n--- DATA IN empresa_180 ---');
        console.table(data.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectEmpresa();
