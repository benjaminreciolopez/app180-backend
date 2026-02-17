import { sql } from '../src/db.js';

async function inspectConstraints() {
    try {
        console.log('Inspeccionando restricciones de calendario_importacion_item_180...');
        const results = await sql`
      SELECT 
        conname as constraint_name, 
        pg_get_constraintdef(c.oid) as constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'calendario_importacion_item_180'
    `;
        console.log('Restricciones encontradas:');
        console.table(results);

        console.log('\nInspeccionando restricciones de calendario_empresa_180...');
        const results2 = await sql`
      SELECT 
        conname as constraint_name, 
        pg_get_constraintdef(c.oid) as constraint_definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'calendario_empresa_180'
    `;
        console.table(results2);
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        process.exit(0);
    }
}

inspectConstraints();
