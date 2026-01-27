
import { sql } from "../src/db.js";
import { resolverPlanDia } from "../src/services/planificacionResolver.js";
import { config } from "dotenv";

config(); // Cargar variables de entorno

async function main() {
  try {
    console.log("🔍 Buscando empleado 'Empleado 1'...");
    
    // 1. Buscar empleado
    const empleados = await sql`
      SELECT id, empresa_id, nombre, cliente_defecto_id 
      FROM employees_180 
      WHERE nombre ILIKE '%Empleado 1%'
      LIMIT 1
    `;

    if (empleados.length === 0) {
      console.error("❌ No se encontró 'Empleado 1'");
      process.exit(1);
    }

    const empleado = empleados[0];
    console.log("✅ Empleado encontrado:", empleado);

    const fecha = new Date().toISOString().slice(0, 10); // Hoy YYYY-MM-DD
    console.log(`📅 Consultando plan para fecha: ${fecha}`);

    // 2. Ejecutar resolverPlanDia
    const plan = await resolverPlanDia({
      empresaId: empleado.empresa_id,
      empleadoId: empleado.id,
      fecha: fecha
    });

    console.log("\n📋 Resultado resolverPlanDia:");
    console.log(JSON.stringify(plan, null, 2));

    // 3. Chequear asignaciones raw
    console.log("\n🕵️ Query asignaciones raw:");
    const asig = await sql`
        SELECT a.id, a.fecha_inicio, a.fecha_fin, a.activo, a.cliente_id
        FROM asignaciones_plantilla_jornada_180 a
        WHERE a.empleado_id = ${empleado.id}
          AND a.activo = true
    `;
    console.table(asig);

    process.exit(0);

  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

main();
