import { sql } from './src/db.js';

async function investigate() {
    try {
        const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
        console.log("All tables:", JSON.stringify(tables.map(t => t.table_name), null, 2));

        const alloc = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_allocations_180'`;
        console.log("Allocations Cols:", JSON.stringify(alloc.map(c => c.column_name), null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

investigate();
