import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";

/**
 * Calcula el reporte de rentabilidad para un rango de fechas y empleados.
 * @param {string} empresaId 
 * @param {string} desde YYYY-MM-DD
 * @param {string} hasta YYYY-MM-DD
 * @param {string|null} empleadoId (Opcional)
 * @returns {Array} Listado de objetos con datos de rentabilidad
 */
export const calcularReporteRentabilidad = async (empresaId, desde, hasta, empleadoId = null) => {
    // 1. Obtener empleados activos en el rango
    const empId = (empleadoId && empleadoId !== 'null' && empleadoId !== '') ? empleadoId : null;

    const empleadosQuery = sql`
      SELECT id, nombre
      FROM employees_180
      WHERE empresa_id = ${empresaId}
        and (${empId}::uuid IS NULL OR id = ${empId})
      ORDER BY nombre
    `;
    const empleados = await empleadosQuery;

    // 2. Para cada empleado, calcular Plan vs Real
    const reporte = [];

    // Generar array de fechas
    const start = new Date(desde);
    const end = new Date(hasta);
    const fechas = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        fechas.push(d.toISOString().slice(0, 10));
    }

    // Calcular sumas totales por empleado en fichajes
    const fichajesTotales = await sql`
      SELECT 
        empleado_id, 
        SUM(minutos_trabajados)::int as minutos_reales
      FROM jornadas_180
      WHERE empresa_id = ${empresaId}
        AND fecha >= ${desde}::date
        AND fecha <= ${hasta}::date
        AND estado = 'completa'
      GROUP BY empleado_id
    `;
    
    // Mapa rápido de reales
    const mapaReales = new Map();
    fichajesTotales.forEach(f => {
        mapaReales.set(f.empleado_id, f.minutos_reales || 0);
    });

    for (const emp of empleados) {
        let minutosPlan = 0;
        
        // Calcular plan dia a dia en paralelo para este empleado
        // Nota: Si esto es muy lento, se podria optimizar más, pero mantenemos logica original
        const promesasDías = fechas.map(fecha => 
            resolverPlanDia({
                empresaId,
                empleadoId: emp.id,
                fecha
            })
        );
        
        const planes = await Promise.all(promesasDías);
        
        for (const plan of planes) {
            if (plan && plan.bloques) {
                for (const b of plan.bloques) {
                    if (!b.inicio || !b.fin) continue;
                    try {
                        const [h1, m1] = b.inicio.split(':').map(Number);
                        const [h2, m2] = b.fin.split(':').map(Number);
                        minutosPlan += (h2 * 60 + m2) - (h1 * 60 + m1);
                    } catch (e) {
                        // Ignorar errores de parseo individuales
                    }
                }
            }
        }

        const minutosReal = mapaReales.get(emp.id) || 0;
        const diferencia = minutosReal - minutosPlan;
        
        // Estado Rentabilidad
        let estado = "neutro";
        // La logica de negocio:
        // Diferencia < -30 (Real < Plan): Ahorro (Verde)
        // Diferencia > 30 (Real > Plan): Exceso (Rojo)
        // Else: Neutro (Azul)
        
        if (diferencia < -30) {
            estado = "ahorro";
        } else if (diferencia > 30) {
            estado = "exceso";
        }

        reporte.push({
            empleado: { id: emp.id, nombre: emp.nombre },
            minutos_plan: minutosPlan,
            minutos_real: minutosReal,
            diferencia: diferencia,
            horas_plan: Math.round((minutosPlan / 60) * 100) / 100,
            horas_real: Math.round((minutosReal / 60) * 100) / 100,
            estado, 
        });
    }

    // Ordenar por diferencia descendente (mayor exceso arriba)
    reporte.sort((a, b) => b.diferencia - a.diferencia);

    return reporte;
};
