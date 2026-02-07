import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectCounts() {
    const dbPath = path.join(__dirname, '..', 'facturacion.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    console.log('--- CONTEO DE FILAS POR TABLA ---');
    for (const table of tables) {
        const count = await db.get(`SELECT COUNT(*) as total FROM ${table.name}`);
        console.log(`${table.name.padEnd(25)}: ${count.total} filas`);
    }
    await db.close();
}

inspectCounts().catch(console.error);
