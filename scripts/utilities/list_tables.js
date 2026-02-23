import { sql } from './src/db.js';

async function listTables() {
    try {
        const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
        console.log('Tablas encontradas:');
        tables.forEach(t => console.log(`- ${t.table_name}`));
        process.exit(0);
    } catch (err) {
        console.error('Error listando tablas:', err);
        process.exit(1);
    }
}

listTables();
