
import { sql } from '../src/db.js';
import { syncDailyReport } from '../src/services/dailyReportService.js';

async function syncAll() {
    try {
        console.log('--- INICIANDO SINCRONIZACIÓN HISTÓRICA ---');

        // 1. Obtener todos los empleados y sus empresas
        const employees = await sql`
      SELECT id, empresa_id FROM employees_180
    `;

        console.log(`Encontrados ${employees.length} empleados.`);

        for (const emp of employees) {
            console.log(`\nProcesando empleado: ${emp.id}`);

            // 2. Obtener fechas únicas donde este empleado tiene trabajos
            const dates = await sql`
        SELECT DISTINCT fecha::date as dia
        FROM work_logs_180
        WHERE employee_id = ${emp.id}
        ORDER BY dia ASC
      `;

            console.log(`Encontrados trabajos en ${dates.length} días distintos.`);

            for (const d of dates) {
                const diaStr = d.dia.toISOString().split('T')[0];
                console.log(`  Sincronizando día: ${diaStr}`);

                await syncDailyReport({
                    empresaId: emp.empresa_id,
                    empleadoId: emp.id,
                    fecha: diaStr
                });
            }
        }

        console.log('\n✅ SINCRONIZACIÓN COMPLETADA CON ÉXITO');
    } catch (err) {
        console.error('❌ Error fatal en la sincronización:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

syncAll();
