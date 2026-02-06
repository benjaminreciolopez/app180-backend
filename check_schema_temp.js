import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function check() {
    try {
        const tables = ['work_logs_180', 'factura_180', 'invoices_180', 'payment_allocations_180'];
        for (const table of tables) {
            const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${table}`;
            console.log(`--- ${table} ---`);
            cols.forEach(c => console.log(`${c.column_name}: ${c.data_type}`));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await sql.end();
    }
}

check();
