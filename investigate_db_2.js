import { sql } from './src/db.js';

async function investigate() {
    try {
        const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%pay%'`;
        console.log("Tables like pay:", JSON.stringify(tables, null, 2));

        const factSchema = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'factura_180'`;
        console.log("Factura Cols:", JSON.stringify(factSchema.map(c => c.column_name), null, 2));

        const factLineas = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'factura_lineas_180'`;
        console.log("Factura Lineas Cols:", JSON.stringify(factLineas.map(c => c.column_name), null, 2));

        const assignments = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%assign%'`;
        console.log("Tables like assign:", JSON.stringify(assignments, null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

investigate();
