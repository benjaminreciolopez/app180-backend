import { obtenerTurnoEmpleado } from "../helpers/fichajesTurnosHelper.js";

/**
 * Validación MVP de fichaje según turno.
 * - Requiere turno asignado
 * - Control nocturno básico
 */
export async function validarFichajeSegunTurno({
  empleadoId,
  empresaId,
  fechaHora = new Date(),
}) {
  const data = await obtenerTurnoEmpleado({
    empleadoId,
    empresaId,
  });

  if (!data) {
    return {
      ok: false,
      status: 404,
      error: "Empleado no encontrado",
    };
  }

  if (!data.turno_id) {
    return {
      ok: false,
      status: 400,
      error: "Empleado sin turno asignado",
      code: "NO_TURNO",
    };
  }

  // 🌙 Regla nocturna MVP: 22:00–06:00
  const hour = fechaHora.getHours();
  const esNocturno = hour >= 22 || hour < 6;

  if (esNocturno && data.nocturno_permitido !== true) {
    return {
      ok: false,
      status: 403,
      error: "Fichaje nocturno no permitido para este turno",
      code: "NO_NOCTURNO",
    };
  }

  return { ok: true };
}
