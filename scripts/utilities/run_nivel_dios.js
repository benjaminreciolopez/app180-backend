import { sql } from './src/db.js';
import fs from 'fs';

async function runLevelGodMigration() {
    try {
        console.log('Aplicando migración Nivel Dios...');
        const migrationPath = './migrations/20260218_nivel_dios_core.sql';
        const sqlContent = fs.readFileSync(migrationPath, 'utf8');

        await sql.unsafe(sqlContent);

        console.log('Migración Nivel Dios aplicada con éxito.');
        process.exit(0);
    } catch (err) {
        console.error('Error aplicando migración:', err);
        process.exit(1);
    }
}

runLevelGodMigration();
