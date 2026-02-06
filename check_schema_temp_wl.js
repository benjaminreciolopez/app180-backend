import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL);

async function check() {
    try {
        const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'work_logs_180'`;
        cols.forEach(c => console.log(`${c.column_name}: ${c.data_type}`));
    } catch (e) {
        console.error(e);
    } finally {
        await sql.end();
    }
}

check();
