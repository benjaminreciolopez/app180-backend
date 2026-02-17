import { sql } from '../src/db.js';

async function applyMigration() {
    try {
        console.log('Aplicando migración: Añadiendo restricción UNIQUE a calendario_importacion_item_180...');
        await sql`
      ALTER TABLE calendario_importacion_item_180 
      ADD CONSTRAINT calendario_importacion_item_180_unique UNIQUE (importacion_id, fecha)
    `;
        console.log('✅ Restricción añadida con éxito.');
    } catch (err) {
        if (err.code === '42P07') {
            console.log('ℹ️ La restricción ya existe.');
        } else {
            console.error('❌ Error aplicando migración:', err.message);
        }
    } finally {
        process.exit(0);
    }
}

applyMigration();
