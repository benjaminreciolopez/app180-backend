import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dumpContent() {
    const dbPath = path.join(__dirname, '..', 'facturacion.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    console.log('\n--- CLIENTES ---');
    const clientes = await db.all("SELECT id, nombre, nif, email FROM cliente");
    console.table(clientes);

    console.log('\n--- FACTURAS ---');
    const facturas = await db.all("SELECT id, numero, fecha, total, cliente_id FROM factura");
    console.table(facturas);

    console.log('\n--- EMISOR (Configuración de la empresa) ---');
    const emisor = await db.all("SELECT id, nombre, nif FROM emisor");
    console.table(emisor);

    await db.close();
}

dumpContent().catch(console.error);
