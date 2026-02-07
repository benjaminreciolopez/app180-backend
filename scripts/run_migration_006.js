import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
    const client = new pg.Client({
        connectionString: process.env.SUPABASE_URL,
    });

    try {
        await client.connect();
        const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '006_extend_work_logs.sql'), 'utf8');
        console.log('Running migration 006...');
        await client.query(sql);
        console.log('Migration 006 completed successfully.');
    } catch (err) {
        console.error('Error running migration:', err);
    } finally {
        await client.end();
    }
}

runMigration();
