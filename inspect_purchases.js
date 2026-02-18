import { sql } from './src/db.js';

async function inspectPurchases() {
    try {
        const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'purchases_180'
      ORDER BY ordinal_position;
    `;
        console.log('Estructura de purchases_180:');
        columns.forEach(c => console.log(`- ${c.column_name}: ${c.data_type} (${c.is_nullable === 'YES' ? 'null' : 'not null'})`));
        process.exit(0);
    } catch (err) {
        console.error('Error inspeccionando purchases_180:', err);
        process.exit(1);
    }
}

inspectPurchases();
