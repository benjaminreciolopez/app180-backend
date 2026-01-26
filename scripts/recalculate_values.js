// scripts/recalculate_values.js
import { sql } from "../src/db.js";

async function main() {
    console.log("🔄 Recalculando valores de trabajos con valor 0...");

    const jobs = await sql`
        SELECT w.id, w.cliente_id, w.minutos 
        FROM work_logs_180 w
        WHERE (w.valor IS NULL OR w.valor = 0)
          AND w.minutos > 0
    `;

    console.log(`🔍 Encontrados ${jobs.length} trabajos para actualizar.`);

    for (const job of jobs) {
        if (!job.cliente_id) continue;

        // Buscar tarifa
        const tariffs = await sql`
            SELECT precio, tipo 
            FROM client_tariffs_180 
            WHERE cliente_id = ${job.cliente_id} AND activo = true
            ORDER BY created_at DESC
            LIMIT 1
        `;

        if (tariffs.length > 0) {
            const tar = tariffs[0];
            let nuevoValor = 0;

            if (tar.tipo === 'hora') {
                nuevoValor = (job.minutos / 60) * Number(tar.precio);
            } else if (tar.tipo === 'dia') {
                nuevoValor = (job.minutos / (8 * 60)) * Number(tar.precio);
            }

            if (nuevoValor > 0) {
                await sql`
                    UPDATE work_logs_180 
                    SET valor = ${nuevoValor}
                    WHERE id = ${job.id}
                `;
                console.log(`✅ Job ${job.id}: ${job.minutos} min -> ${nuevoValor.toFixed(2)}€ (${tar.tipo} @ ${tar.precio})`);
            }
        } else {
            console.log(`⚠️ Job ${job.id}: Sin tarifa activa para cliente ${job.cliente_id}`);
        }
    }

    console.log("🏁 Terminado.");
    process.exit(0);
}

main().catch(console.error);
