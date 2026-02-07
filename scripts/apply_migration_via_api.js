// Script para aplicar migración 006 usando el cliente de postgres
import { sql } from '../src/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  try {
    console.log('📦 Aplicando migración 006...');

    const migrationPath = join(__dirname, '../migrations/006_add_iva_percent_to_lineafactura.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Ejecutar cada statement por separado
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      await sql.unsafe(statement);
      console.log('✅ Ejecutado:', statement.substring(0, 50) + '...');
    }

    console.log('✅ Migración 006 aplicada correctamente');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error aplicando migración:', err);
    process.exit(1);
  }
}

applyMigration();
