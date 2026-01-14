// backend/src/services/fichajesValidacionService.js
import { obtenerTurnoEmpleado } from "../helpers/fichajesTurnosHelper.js";

export async function validarFichajeSegunTurno({
  empleadoId,
  empresaId,
  fechaHora = new Date(),
}) {
  const data = await obtenerTurnoEmpleado({ empleadoId, empresaId });

  // Error técnico (empleado no existe / no pertenece)
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "Empleado no encontrado",
    };
  }

  const incidencias = [];
  const warnings = [];

  // Sin turno: se permite fichar, se marca incidencia
  if (!data.turno_id) {
    incidencias.push("Empleado sin turno asignado");
    return {
      ok: true,
      data,
      incidencias,
      warnings,
      meta: { tiene_turno: false, es_nocturno: false },
    };
  }

  // Nocturnidad (MVP 22:00–06:00): no se bloquea, solo incidencia
  const hour = fechaHora.getHours();
  const esNocturno = hour >= 22 || hour < 6;

  if (esNocturno && data.nocturno_permitido !== true) {
    incidencias.push("Fichaje nocturno fuera de lo permitido por el turno");
  }

  return {
    ok: true,
    data,
    incidencias,
    warnings,
    meta: { tiene_turno: true, es_nocturno: esNocturno },
  };
}
