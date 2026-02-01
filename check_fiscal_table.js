import { sql } from './src/db.js';

async function check() {
    try {
        try {
            const r = await sql`select count(*) from client_fiscal_data_180`;
            console.log("client_fiscal_data_180 exists");
        } catch (e) { console.log("client_fiscal_data_180 error:", e.message); }

        try {
            const r2 = await sql`select count(*) from datos_fiscales_cliente_180`;
            console.log("datos_fiscales_cliente_180 exists");
        } catch (e) { console.log("datos_fiscales_cliente_180 error:", e.message); }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
