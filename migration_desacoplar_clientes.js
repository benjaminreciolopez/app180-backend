import { sql } from './src/db.js';

async function migrate() {
  try {
    console.log('--- Iniciando migración ---');

    console.log('1. Hacer cliente_id opcional en empleado_plantillas_180...');
    await sql`
      ALTER TABLE empleado_plantillas_180 
      ALTER COLUMN cliente_id DROP NOT NULL
    `;
    console.log('   -> HECHO (o ya era nullable)');

    console.log('2. Crear tabla empleado_clientes_180...');
    await sql`
      CREATE TABLE IF NOT EXISTS empleado_clientes_180 (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        empleado_id uuid NOT NULL,
        cliente_id uuid NOT NULL,
        fecha_inicio date NOT NULL,
        fecha_fin date,
        activo boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `;
    console.log('   -> HECHO');

    console.log('--- Migración completada con éxito ---');
  } catch (err) {
    console.error('ERROR en migración:', err);
  } finally {
    process.exit();
  }
}

migrate();
