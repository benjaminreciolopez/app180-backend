import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dumpConfig() {
    const dbPath = path.join(__dirname, '..', 'facturacion.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    console.log('\n--- EMISOR (SQLite) ---');
    const emisor = await db.all("SELECT * FROM emisor");
    console.table(emisor);

    console.log('\n--- CONFIGURACION SISTEMA (SQLite) ---');
    const config = await db.all("SELECT * FROM configuracionsistema");
    console.table(config);

    await db.close();
}

dumpConfig().catch(console.error);
