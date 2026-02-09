import { sql } from "../db.js";
import { config } from "../config.js";

async function debug() {
    try {
        if (!config.supabase.url) throw new Error("No URL");

        const clientes = await sql`SELECT * FROM clients_180 WHERE nombre ILIKE '%Pica%'`;
        if (clientes.length === 0) return console.log("No client found");
        const cliente = clientes[0];

        console.log(`\n📋 TRABAJOS TOTALES DE: ${cliente.nombre}`);

        const logs = await sql`
        SELECT *
        FROM work_logs_180 
        WHERE cliente_id = ${cliente.id}
        ORDER BY fecha DESC
    `;

        console.log(`TOTAL REGISTROS: ${logs.length}`);

        const unbilled = logs.filter(l => !l.factura_id);
        console.log(`SIN FACTURA: ${unbilled.length}`);

        unbilled.forEach(l => {
            console.log(`>> [${new Date(l.fecha).toISOString().split('T')[0]}] ${l.descripcion?.substring(0, 30)} | Val:${l.valor} Pag:${l.pagado} | Est:${l.estado_pago}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
debug();
