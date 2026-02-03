import { sql } from './src/db.js';

async function investigate() {
    try {
        const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'lineafactura_180'`;
        console.log("Lineafactura Cols:", JSON.stringify(cols.map(c => c.column_name), null, 2));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

investigate();
