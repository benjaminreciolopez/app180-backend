
import { sql } from './src/db.js';

async function checkRecentAssignments() {
    console.log(`Checking recent assignments...`);

    try {
        const rows = await sql`
            SELECT 
                a.id, 
                a.empleado_id, 
                e.nombre as emp_nombre,
                a.fecha_inicio, 
                a.fecha_fin, 
                p.nombre as plantilla
            FROM empleado_plantillas_180 a
            LEFT JOIN employees_180 e ON e.id = a.empleado_id
            LEFT JOIN plantillas_jornada_180 p ON p.id = a.plantilla_id
            ORDER BY a.fecha_inicio DESC
            LIMIT 5
        `;
        
        console.log("Last 5 assignments (by start date):");
        rows.forEach(r => {
             console.log(`- Emp: ${r.emp_nombre || 'NULL (Admin/Vacante)'} | Plan: ${r.plantilla} | ${r.fecha_inicio} -> ${r.fecha_fin || 'Indefinido'}`);
        });
    } catch (e) {
        console.error('Error:', e);
    }
}

(async () => {
    await checkRecentAssignments();
    process.exit(0);
})();
