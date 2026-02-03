import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function check() {
    try {
        const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'factura_180'`;
        console.log('Factura columns:', columns.map(c => c.column_name));

        const wlColumns = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'work_logs_180'`;
        console.log('Work logs columns:', wlColumns.map(c => `${c.column_name} (${c.data_type})`));

        const fColumns = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_180'`;
        console.log('Factura columns:', fColumns.map(c => `${c.column_name} (${c.data_type})`));

        const invColumns = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'invoices_180'`;
        console.log('Invoices columns:', invColumns.map(c => `${c.column_name} (${c.data_type})`));
    } catch (e) {
        console.error(e);
    } finally {
        await sql.end();
    }
}

check();
