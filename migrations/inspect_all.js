import { sql } from '../src/db.js';

async function main() {
    try {
        console.log('--- TABLES ---');
        const tables = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' AND tablename LIKE '%180'
    `;
        console.table(tables);

        for (const t of tables) {
            console.log(`\n--- COLUMNS: ${t.tablename} ---`);
            const cols = await sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = ${t.tablename}
      `;
            console.table(cols);
        }

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

main();
