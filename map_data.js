
import { sql } from './src/db.js';

async function mapDataOwners() {
    console.log(`Mapping Data Owners...`);

    try {
        // 1. List all employees
        const employees = await sql`SELECT id, nombre FROM employees_180`;
        console.log("All Employees:", employees);
        const empMap = new Map(employees.map(e => [e.id, e.nombre]));

        // 2. Check Planings owners
        const planings = await sql`
            SELECT DISTINCT(empleado_id) 
            FROM empleado_plantillas_180 
            WHERE empleado_id IS NOT NULL
        `;
        console.log("Employees with Planings:");
        planings.forEach(p => {
             console.log(`- ID: ${p.empleado_id}, Name: ${empMap.get(p.empleado_id) || 'Unknown'}`);
        });

        // 3. Check Jornadas owners
        const jornadas = await sql`
            SELECT DISTINCT(empleado_id) 
            FROM jornadas_180
        `;
        console.log("Employees with Jornadas:");
        jornadas.forEach(p => {
             console.log(`- ID: ${p.empleado_id}, Name: ${empMap.get(p.empleado_id) || 'Unknown'}`);
        });
        
    } catch (e) {
        console.error('Error:', e);
    }
}

(async () => {
    await mapDataOwners();
    process.exit(0);
})();
