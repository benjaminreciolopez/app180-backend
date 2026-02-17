import { sql } from '../src/db.js';
import fs from 'fs';

async function main() {
    try {
        const res = await sql`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_name LIKE '%180' 
        AND column_name IN ('descripcion', 'detalles')
      ORDER BY table_name;
    `;
        console.table(res);
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

main();
