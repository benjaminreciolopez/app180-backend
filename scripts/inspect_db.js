import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect() {
    const dbPath = path.join(__dirname, '..', 'facturacion.db');

    // Abrir la base de datos
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log('--- TABLAS ENCONTRADAS ---');
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");

    for (const table of tables) {
        console.log(`\nTabla: ${table.name}`);
        const columns = await db.all(`PRAGMA table_info(${table.name})`);
        console.table(columns.map(c => ({
            Nombre: c.name,
            Tipo: c.type,
            PK: c.pk === 1 ? 'SÍ' : 'NO',
            NotNull: c.notnull === 1 ? 'SÍ' : 'NO'
        })));

        // Ver una muestra de datos (3 filas)
        const sample = await db.all(`SELECT * FROM ${table.name} LIMIT 3`);
        if (sample.length > 0) {
            console.log('Muestra de datos:');
            console.table(sample);
        } else {
            console.log('(Sin datos)');
        }
    }

    await db.close();
}

inspect().catch(err => {
    console.error('Error inspeccionando la DB:', err);
});
