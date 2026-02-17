import { sql } from '../src/db.js';
import fs from 'fs';

async function main() {
    let output = '';
    try {
        output += '--- TABLES ---\n';
        const tables = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' AND tablename LIKE '%180'
    `;
        output += JSON.stringify(tables, null, 2) + '\n';

        for (const t of tables) {
            output += `\n--- COLUMNS: ${t.tablename} ---\n`;
            const cols = await sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = ${t.tablename}
      `;
            output += JSON.stringify(cols, null, 2) + '\n';
        }

    } catch (err) {
        output += '\nERROR: ' + err.message + '\n';
    } finally {
        fs.writeFileSync('c:\\Users\\benja\\Desktop\\app180\\backend\\migrations\\schema_dump.json', output);
        await sql.end();
        process.exit(0);
    }
}

main();
