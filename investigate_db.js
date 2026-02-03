import { sql } from './src/db.js';

async function investigate() {
    try {
        console.log("--- FACTURAS ---");
        const facturas = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_180'`;
        console.log(JSON.stringify(facturas, null, 2));

        console.log("--- LINEAS DE FACTURA ---");
        const lineas = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_lineas_180'`;
        console.log(JSON.stringify(lineas, null, 2));

        console.log("--- ASIGNACIONES DE PAGO ---");
        const assignments = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payment_assignments_180'`;
        console.log(JSON.stringify(assignments, null, 2));

        console.log("--- WORK LOGS ---");
        const workLogs = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'work_logs_180'`;
        console.log(JSON.stringify(workLogs, null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

investigate();
