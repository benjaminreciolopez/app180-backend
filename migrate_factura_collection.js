import { sql } from './src/db.js';

async function run() {
    try {
        await sql`ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS pagado NUMERIC DEFAULT 0`;
        await sql`ALTER TABLE factura_180 ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'pendiente'`;
        console.log("Migration successful: Added pagado and estado_pago to factura_180");
    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        process.exit();
    }
}

run();
