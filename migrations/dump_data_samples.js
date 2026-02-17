import { sql } from '../src/db.js';
import fs from 'fs';

async function main() {
    try {
        const conceptos = await sql`SELECT id, empresa_id, descripcion FROM concepto_180 LIMIT 10`;
        fs.writeFileSync('c:\\Users\\benja\\Desktop\\app180\\backend\\migrations\\conceptos_data.json', JSON.stringify(conceptos, null, 2));

        const items = await sql`SELECT id, empresa_id, nombre, descripcion FROM work_items_180 LIMIT 10`;
        fs.writeFileSync('c:\\Users\\benja\\Desktop\\app180\\backend\\migrations\\items_data.json', JSON.stringify(items, null, 2));

        const worklogs = await sql`SELECT id, empresa_id, descripcion, detalles FROM work_logs_180 LIMIT 10`;
        fs.writeFileSync('c:\\Users\\benja\\Desktop\\app180\\backend\\migrations\\worklogs_data.json', JSON.stringify(worklogs, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

main();
