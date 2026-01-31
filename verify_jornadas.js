
import { sql } from './src/db.js';

async function verifyJornadas(empresaId, empleadoId) {
    console.log(`Verifying JORNADAS with empresaId=${empresaId}, empleadoId=${empleadoId}`);
    
    const desde = '2026-01-01';
    const hasta = '2026-12-31';
    const empleadoIdSafe = empleadoId || null;

    try {
        const jornadas = await sql`
        SELECT
          j.id,
          j.empleado_id,
          j.fecha
        FROM jornadas_180 j
        WHERE j.empresa_id = ${empresaId}::uuid
          AND j.fecha BETWEEN ${desde}::date AND ${hasta}::date
          AND (${empleadoIdSafe}::uuid IS NULL OR j.empleado_id = ${empleadoIdSafe}::uuid)
        ORDER BY j.fecha ASC, j.inicio ASC
      `;
      console.log(`Found ${jornadas.length} jornadas`);
      if (jornadas.length > 0) console.log(jornadas[0]);
    } catch (e) {
        console.error('Error executing query:', e);
    }
}

(async () => {
    // Probar con UUID válido y con null
    await verifyJornadas('bd6672e7-923b-42d5-8af1-aefa08e9ab6a', 'efb4ba22-e474-4ce8-8a80-0f4eb815e13e');
    process.exit(0);
})();
