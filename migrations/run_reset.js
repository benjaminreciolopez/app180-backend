import { sql } from '../src/db.js';

async function main() {
  try {
    // 1. Get all _180 tables except festivos
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename LIKE '%_180'
      AND tablename NOT IN ('festivos_es_180', 'festivo_es_180')
    `;

    console.log(`Found ${tables.length} tables to truncate`);

    // 2. Disable FK checks
    await sql`SET session_replication_role = 'replica'`;

    // 3. Truncate each table
    for (const t of tables) {
      try {
        await sql.unsafe(`TRUNCATE TABLE ${t.tablename} CASCADE`);
        console.log(`  TRUNCATED: ${t.tablename}`);
      } catch (e) {
        console.log(`  SKIP (not found): ${t.tablename}`);
      }
    }

    // 4. Re-enable FK checks
    await sql`SET session_replication_role = 'origin'`;

    console.log('\nRESET completado');

    // 5. Run auth migration
    console.log('\nEjecutando migraciones...');

    await sql`ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE`;
    console.log('  ADD google_id');

    await sql`ALTER TABLE users_180 ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
    console.log('  ADD avatar_url');

    await sql`ALTER TABLE users_180 ALTER COLUMN password DROP NOT NULL`;
    console.log('  password nullable');

    await sql`ALTER TABLE empresa_config_180 ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB DEFAULT '[]'::jsonb`;
    console.log('  ADD dashboard_widgets');

    console.log('\nMigraciones completadas');
  } catch (e) {
    console.error('Error:', e.message);
  }

  await sql.end();
  process.exit(0);
}

main();
