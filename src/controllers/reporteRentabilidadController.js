import { sql } from "../db.js";
import { handleErr } from "../utils/errorHandler.js";
import { getEmpresaIdAdminOrThrow } from "../services/authService.js";
import { resolverPlanDia } from "../services/planificacionResolver.js";

/**
 * Reporte de Rentabilidad (Horas Planificadas vs Horas Reales)
 *
 * GET /admin/reportes/rentabilidad
 * Query Params:
 * - desde: YYYY-MM-DD
 * - hasta: YYYY-MM-DD
 * - empleado_id: uuid (opcional)
 */
export const getReporteRentabilidad = async (req, res) => {
  try {
    const empresaId = await getEmpresaIdAdminOrThrow(req.user.id);
    const { desde, hasta, empleado_id = null } = req.query;

    if (!desde || !hasta) {
      return res.status(400).json({ error: "Se requieren parámetros desde y hasta" });
    }

    // 1. Obtener empleados activos en el rango
    // (Simplificación: empleados que existen y no eliminados)
    const empId = (empleado_id && empleado_id !== 'null' && empleado_id !== '') ? empleado_id : null;

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

    // Iterar días del rango (costoso si es rango largo, optimizable en futuro)
    // Generar array de fechas
    const start = new Date(desde);
    const end = new Date(hasta);
    const fechas = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        fechas.push(d.toISOString().slice(0, 10));
    }

    // Buscamos TODOS los fichajes validados del periodo de una vez para minimizar queries?
    // Mejor optimización: calcular sumas totales por empleado en fichajes
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


    // Para el planificado, como depende de resolverPlanDia (lógica compleja de turnos/excepciones/festivos),
    // tenemos que iterar. Para optimizar, lo hacemos por empleado.
    // NOTA: Esto puede ser lento para muchos empleados y muchos días. 
    // Para V1 asumimos volumen moderado.
    
    for (const emp of empleados) {
        console.time(`[rentabilidad] emp: ${emp.nombre}`);
        let minutosPlan = 0;
        
        // Calcular plan dia a dia en paralelo para este empleado
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
        console.timeEnd(`[rentabilidad] emp: ${emp.nombre}`);

        const minutosReal = mapaReales.get(emp.id) || 0;
        const diferencia = minutosReal - minutosPlan;
        
        // Estado Rentabilidad
        let estado = "neutro";
        let color = "blue"; // Justo / Neutro
        
        // Margen de tolerancia (ej. 30 mins)
        if (diferencia < -30) {
            estado = "ahorro";
            color = "green"; // A favor de la empresa (menos horas pagadas de las presupuestadas -> mas margen, OJO logica de negocio)
            // USUARIO DIJO: "desviacion a favor y otro para desviacion por exceso"
            // Exceso de tiempo = Malo (ROJO)
            // Tiempo justo = Bien
            // Menos tiempo = Ahorro? O Falta? 
            // Asumimos: Menos tiempo = Ahorro (Verde), Mas tiempo = Coste Extra (Rojo).
        } else if (diferencia > 30) {
            estado = "exceso";
            color = "red";
        }

        reporte.push({
            empleado: { id: emp.id, nombre: emp.nombre },
            minutos_plan: minutosPlan,
            minutos_real: minutosReal,
            diferencia: diferencia,
            horas_plan: Math.round((minutosPlan / 60) * 100) / 100,
            horas_real: Math.round((minutosReal / 60) * 100) / 100,
            estado, // id interno
            color   // sugerencia frontend
        });
    }

    // Ordenar por Exceso (los que mas se pasan primero?)
    reporte.sort((a, b) => b.diferencia - a.diferencia);

    res.json(reporte);

  } catch (err) {
    console.error("❌ ERROR EN REPORTE RENTABILIDAD:", err);
    handleErr(res, err, "getReporteRentabilidad");
  }
};
