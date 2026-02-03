import { sql } from './src/db.js';

async function run() {
    try {
        await sql`ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES factura_180(id) ON DELETE SET NULL`;
        await sql`ALTER TABLE payment_allocations_180 ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES factura_180(id) ON DELETE SET NULL`;
        console.log("Migration successful");
    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        process.exit();
    }
}

run();
