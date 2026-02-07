import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function dumpPGConfig() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        console.log('\n--- EMISOR_180 (PostgreSQL) ---');
        const emisor = await client.query('SELECT * FROM emisor_180');
        console.table(emisor.rows);

        console.log('\n--- CONFIGURACION SISTEMA (PostgreSQL) ---');
        const config = await client.query('SELECT * FROM configuracionsistema_180');
        console.table(config.rows);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

dumpPGConfig();
