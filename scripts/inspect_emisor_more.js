import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function inspectEmisorMore() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        console.log(`\n--- COLUMNS OF emisor_180 ---`);
        const res = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'emisor_180'
            ORDER BY ordinal_position
        `);
        console.table(res.rows);

        const data = await client.query('SELECT * FROM emisor_180 LIMIT 1');
        console.log('\n--- DATA IN emisor_180 ---');
        console.log(JSON.stringify(data.rows[0], null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectEmisorMore();
