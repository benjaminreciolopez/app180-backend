import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";
import { inferirTipoTurnoDesdePlan } from "../helpers/turnosInferenciaHelper.js";
import { getOrCreateTurnoCatalogo } from "./turnoAutoService.js";

export async function recalcularTurnosDesdePlantilla({
  empresaId,
  plantillaId,
  fecha = null,
  tx = null,
}) {
  const db = tx || sql;

  // Empleados con esta plantilla activa
  const empleados = await db`
    SELECT ep.empleado_id
    FROM empleado_plantillas_180 ep
    JOIN plantillas_jornada_180 p ON p.id = ep.plantilla_id
    WHERE ep.plantilla_id = ${plantillaId}
      AND p.empresa_id = ${empresaId}
      AND p.activo = true
      AND ep.fecha_inicio <= COALESCE(${fecha}::date, CURRENT_DATE)
      AND (ep.fecha_fin IS NULL OR ep.fecha_fin >= COALESCE(${fecha}::date, CURRENT_DATE))
  `;

  for (const e of empleados) {
    const f = fecha || new Date().toISOString().slice(0, 10);

    const plan = await resolverPlanDia({
      empresaId,
      empleadoId: e.empleado_id,
      fecha: f,
    });

    const tipo_turno = inferirTipoTurnoDesdePlan(plan);

    const turno = await getOrCreateTurnoCatalogo(
      { empresaId, tipo: tipo_turno },
      db
    );

    await db`
      UPDATE employees_180
      SET turno_id = ${turno.id}
      WHERE id = ${e.empleado_id}
        AND empresa_id = ${empresaId}
    `;
  }
}
