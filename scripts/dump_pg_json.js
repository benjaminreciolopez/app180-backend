import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function dumpPGConfig() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();

        const emisor = await client.query('SELECT * FROM emisor_180');
        const config = await client.query('SELECT * FROM configuracionsistema_180');

        const result = {
            emisor: emisor.rows,
            config: config.rows
        };

        fs.writeFileSync(path.join(__dirname, 'pg_config_dump.json'), JSON.stringify(result, null, 2));
        console.log('PG config dumped to scripts/pg_config_dump.json');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

dumpPGConfig();
