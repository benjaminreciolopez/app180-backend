import { sql } from './src/db.js';

(async () => {
  try {
    const tablas = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname='public' 
        AND tablename LIKE '%plantilla%' 
      ORDER BY tablename
    `;
    
    console.log('Tablas de plantilla encontradas:');
    tablas.forEach(row => console.log(`  - ${row.tablename}`));
    
    // Verificar RLS en esas tablas
    console.log('\nVerificación de RLS:');
    for (const row of tablas) {
      const rls = await sql`
        SELECT rowsecurity 
        FROM pg_tables 
        WHERE tablename = ${row.tablename}
      `;
      const enabled = rls[0]?.rowsecurity ? '✓ HABILITADA' : '✗ DESHABILITADA';
      console.log(`  ${row.tablename}: ${enabled}`);
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
