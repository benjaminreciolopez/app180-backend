import { sql } from './src/db.js';

async function check() {
    try {
        try {
            const r = await sql`select * from concepto_180 limit 1`;
            console.log("concepto_180:", r);
        } catch (e) { console.log("concepto_180 error:", e.message); }

        try {
            const r2 = await sql`select * from conceptos_facturables_180 limit 1`;
            console.log("conceptos_facturables_180:", r2);
        } catch (e) { console.log("conceptos_facturables_180 error:", e.message); }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
