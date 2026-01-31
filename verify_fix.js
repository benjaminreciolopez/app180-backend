
import { sql } from './src/db.js';

async function verifyQuery(empresaId, empleadoId) {
    console.log(`Verifying with empresaId=${empresaId}, empleadoId=${empleadoId}`);
    
    const desde = '2026-01-01';
    const hasta = '2026-12-31';
    const empleadoIdSafe = empleadoId || null;

    try {
        // La query simplificada
        const asignaciones = await sql`
        SELECT 
          a.id,
          a.empleado_id
        FROM empleado_plantillas_180 a
        WHERE a.empresa_id = ${empresaId}::uuid
          AND a.fecha_inicio <= ${hasta}::date
          AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${desde}::date)
          AND (${empleadoIdSafe}::uuid IS NULL OR a.empleado_id = ${empleadoIdSafe}::uuid)
      `;
      console.log(`Found ${asignaciones.length} asignaciones`);
      console.log(asignaciones);
    } catch (e) {
        console.error('Error executing query:', e);
    }
}

(async () => {
    // Probar con UUID válido y con null
    await verifyQuery('bd6672e7-923b-42d5-8af1-aefa08e9ab6a', 'efb4ba22-e474-4ce8-8a80-0f4eb815e13e');
    await verifyQuery('bd6672e7-923b-42d5-8af1-aefa08e9ab6a', null);
    process.exit(0);
})();
