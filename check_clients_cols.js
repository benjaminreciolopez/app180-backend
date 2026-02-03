import { sql } from './src/db.js';

async function check() {
    try {
        const cols = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'clients_180'
            ORDER BY ordinal_position
        `;
        console.log(JSON.stringify(cols, null, 2));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        process.exit();
    }
}

check();
