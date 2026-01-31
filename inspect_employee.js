
import { sql } from './src/db.js';

async function inspectData(empleadoId) {
    console.log(`Inspecting data for employee: ${empleadoId}`);

    try {
        // 1. Check Employee
        const emp = await sql`SELECT * FROM employees_180 WHERE id = ${empleadoId}`;
        console.log("Employee Record:", emp);

        // 2. Check Planings (Asignaciones)
        const planings = await sql`
            SELECT id, empleado_id, plantilla_id, fecha_inicio, fecha_fin 
            FROM empleado_plantillas_180 
            WHERE empleado_id = ${empleadoId}
        `;
        console.log(`Found ${planings.length} planings for this employee.`);
        if(planings.length > 0) console.log(planings[0]);

        // 3. Check Jornadas
        const jornadas = await sql`
            SELECT id, fecha, inicio 
            FROM jornadas_180 
            WHERE empleado_id = ${empleadoId} 
            LIMIT 5
        `;
        console.log(`Found ${jornadas.length} jornadas (limit 5).`);
        
    } catch (e) {
        console.error('Error:', e);
    }
}

(async () => {
    await inspectData('efb4ba22-e474-4ce8-8a80-0f4eb815e13e');
    process.exit(0);
})();
