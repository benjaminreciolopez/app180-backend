
import { sql } from './src/db.js';

async function testGetEmployees(userId) {
    console.log(`Testing getEmployeesAdmin query for user: ${userId}`);

    try {
        // 1. Get Empresa ID
        const empresa = await sql`SELECT id FROM empresa_180 WHERE user_id = ${userId}`;
        if (!empresa.length) {
            console.log("Empresa not found for this user.");
            return;
        }
        const empresaId = empresa[0].id;
        console.log(`Empresa ID: ${empresaId}`);

        // 2. Run the query from controller
        const empleados = await sql`
        SELECT DISTINCT ON (e.id)
            e.id,
            e.nombre,
            u.email,
            e.activo,
            d.device_hash,
            d.activo AS dispositivo_activo,
            p.id AS plantilla_id,
            p.nombre AS plantilla_nombre
        FROM employees_180 e
        JOIN users_180 u ON u.id = e.user_id

        LEFT JOIN employee_devices_180 d
            ON d.empleado_id = e.id
        AND d.activo = true

        LEFT JOIN empleado_plantillas_180 ep
            ON ep.empleado_id = e.id
        AND ep.fecha_inicio <= CURRENT_DATE
        AND (ep.fecha_fin IS NULL OR ep.fecha_fin >= CURRENT_DATE)

        LEFT JOIN plantillas_jornada_180 p
            ON p.id = ep.plantilla_id
        AND p.activo = true

        WHERE e.empresa_id = ${empresaId}
        ORDER BY e.id, ep.fecha_inicio DESC
        `;

        console.log(`Found ${empleados.length} employees with INNER JOIN users_180.`);
        empleados.forEach(e => console.log(`- ${e.nombre} (${e.email})`));

        // 3. Compare with LEFT JOIN
        const allEmployees = await sql`
            SELECT count(*) as count FROM employees_180 WHERE empresa_id = ${empresaId}
        `;
        console.log(`Total employees in table for this company: ${allEmployees[0].count}`);

    } catch (e) {
        console.error('Error:', e);
    }
}

(async () => {
    // Usar el ID del usuario admin del contexto anterior
    await testGetEmployees('9b1bbf64-f5fc-4954-97d3-7b78fdba95a6'); 
    process.exit(0);
})();
