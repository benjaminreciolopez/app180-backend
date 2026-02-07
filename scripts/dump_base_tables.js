import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dumpTable(tableName) {
    const dbPath = path.join(__dirname, '..', 'facturacion.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    console.log(`--- CONTENIDO DE LA TABLA: ${tableName} ---`);
    const rows = await db.all(`SELECT * FROM ${tableName}`);
    console.table(rows);
    await db.close();
}

dumpTable('emisor').catch(console.error);
dumpTable('user').catch(console.error);
