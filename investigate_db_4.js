import { sql } from './src/db.js';

async function investigate() {
    try {
        const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='invoices_180'`;
        console.log("Invoices 180 Cols:", JSON.stringify(c.map(x => x.column_name), null, 2));

        const f = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='factura_180'`;
        console.log("Factura 180 Cols:", JSON.stringify(f.map(x => x.column_name), null, 2));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

investigate();
