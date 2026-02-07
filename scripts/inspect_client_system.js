import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function inspectTables() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        const tables = ['clients_180', 'client_fiscal_data_180', 'cliente_seq_180', 'empresa_config_180'];

        for (const table of tables) {
            console.log(`\n--- SCHEMA OF ${table} ---`);
            const res = await client.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            console.table(res.rows);
        }

        console.log('\n--- DATA IN cliente_seq_180 ---');
        const seqData = await client.query('SELECT * FROM cliente_seq_180');
        console.table(seqData.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

inspectTables();
