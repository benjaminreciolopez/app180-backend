import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.SUPABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('DATABASE_URL or SUPABASE_URL is not defined in .env');
    process.exit(1);
}

const sql = postgres(connectionString);

async function runMigration() {
    const migrationPath = path.join(__dirname, '../migrations/20260220_add_client_retention_and_verifactu.sql');

    if (!fs.existsSync(migrationPath)) {
        console.error(`Migration file not found: ${migrationPath}`);
        process.exit(1);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Applying retention migration...');
    try {
        await sql.unsafe(migrationSql);
        console.log('Migration applied successfully.');
    } catch (error) {
        console.error('Error applying migration:', error);
    } finally {
        await sql.end();
    }
}

runMigration();
