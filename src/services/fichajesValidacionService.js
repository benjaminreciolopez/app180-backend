// backend/src/services/fichajesValidacionService.js

import { obtenerTurnoEmpleado } from "../helpers/fichajesTurnosHelper.js";
import { resolverPlanDia } from "./planificacionResolver.js";

// Date -> YYYY-MM-DD (server local)
function toYMD(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// "HH:MM:SS" -> minutos desde 00:00
function hhmmssToMinutes(h) {
  if (!h) return null;
  const s = String(h).slice(0, 8); // por si viene "HH:MM"
  const [hh, mm, ss] = s.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm + (Number.isFinite(ss) ? ss / 60 : 0);
}

// Date -> minutos desde 00:00
function dateToMinutes(date) {
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Tipo fichaje -> tipo esperado plantilla (MVP)
function mapFichajeToPlanTipo(tipoFichaje) {
  // En tu planificador los bloques son text: trabajo/descanso/pausa/comida/otro
  // En fichajes tienes: entrada/salida/descanso_inicio/descanso_fin
  if (tipoFichaje === "entrada" || tipoFichaje === "salida") return "trabajo";
  if (tipoFichaje === "descanso_inicio" || tipoFichaje === "descanso_fin")
    return "descanso";
  return null;
}

/**
 * Valida (NO bloquea) un fichaje contra:
 * - Turno del empleado (nocturnidad, etc.)
 * - Planificación del día (plantillas: rango + bloques esperados)
 *
 * Devuelve:
 * {
 *   ok: true/false,
 *   status,
 *   error,
 *   incidencias: string[],
 *   warnings: string[],
 *   meta: { tiene_turno, es_nocturno, tiene_plan, modo_plan, plantilla_id }
 *   data: info turno empleado
 *   plan: (opcional) plan del día para depurar/UI
 * }
 */
export async function validarFichajeSegunTurno({
  empleadoId,
  empresaId,
  fechaHora = new Date(),
  tipo = null,
}) {
  const data = await obtenerTurnoEmpleado({ empleadoId, empresaId });


  // Error técnico (empleado no existe / no pertenece)
  if (!data) {
    return {
      ok: true,
      data: null,
      incidencias: ["Empleado sin turno configurado"],
      warnings: [],
      meta: {
        tiene_turno: false,
        es_nocturno: false,
        tiene_plan: false,
        modo_plan: null,
        plantilla_id: null,
      },
    };
  }

  const incidencias = [];
  const warnings = [];

  // -------------------------
  // 1) TURNO (como lo tenías)
  // -------------------------
  const hour = new Date(fechaHora).getHours();
  const esNocturno = hour >= 22 || hour < 6;

  if (!data.turno_id) {
    incidencias.push("Empleado sin turno asignado");
  } else {
    if (esNocturno && data.nocturno_permitido !== true) {
      incidencias.push("Fichaje nocturno fuera de lo permitido por el turno");
    }
  }

  // -----------------------------------------
  // 2) PLANIFICACIÓN (plantilla del empleado)
  // -----------------------------------------
  const fecha = toYMD(fechaHora);

  let plan = null;
  try {
    plan = await resolverPlanDia({
      empresaId,
      empleadoId,
      fecha,
    });
  } catch (e) {
    // No bloqueamos por fallo técnico de planificación, pero lo registramos
    warnings.push("No se pudo resolver la planificación del día");
    plan = null;
  }

  const tienePlan = !!(plan && plan.plantilla_id);

  if (!tienePlan) {
    // MVP: no hay plantilla asignada o no aplica al día
    incidencias.push("Empleado sin plantilla asignada para este día");
  } else {
    // 2.1 Validar rango esperado (si existe)
    const tMin = dateToMinutes(fechaHora);

    const rIni = plan?.rango?.inicio
      ? hhmmssToMinutes(plan.rango.inicio)
      : null;
    const rFin = plan?.rango?.fin ? hhmmssToMinutes(plan.rango.fin) : null;

    // Margen de cortesía (MVP): 10 min
    const GRACE_MIN = 10;

    if (rIni != null && rFin != null) {
      const dentroConMargen =
        tMin >= rIni - GRACE_MIN && tMin <= rFin + GRACE_MIN;

      if (!dentroConMargen) {
        incidencias.push(
          `Fichaje fuera del rango esperado (${plan.rango.inicio}–${plan.rango.fin})`,
        );
      }
    }

    // 2.2 Validar tipo de bloque esperado (muy MVP)
    // - Si el plan tiene bloques "descanso" y se ficha descanso => ok (si no, incidencia)
    // - Si NO hay descansos esperados y se ficha descanso => incidencia
    // - Para entrada/salida solo registramos si el plan está vacío
    const planBloques = Array.isArray(plan?.bloques) ? plan.bloques : [];
    const tipoPlan = mapFichajeToPlanTipo(tipo);

    if (tipoPlan === "descanso") {
      const hayDescansoPlan = planBloques.some((b) =>
        String(b.tipo || "")
          .toLowerCase()
          .includes("descanso"),
      );
      if (!hayDescansoPlan) {
        incidencias.push(
          "Descanso registrado pero no existe descanso en plantilla",
        );
      }
    }

    if ((tipo === "entrada" || tipo === "salida") && planBloques.length === 0) {
      incidencias.push(
        "La plantilla del día no define bloques (solo rango o vacío)",
      );
    }
  }

  return {
    ok: true,
    data,
    incidencias,
    warnings,
    meta: {
      tiene_turno: !!data.turno_id,
      es_nocturno: esNocturno,
      tiene_plan: tienePlan,
      modo_plan: plan?.modo ?? null,
      plantilla_id: plan?.plantilla_id ?? null,
    },
    // Útil para debug/UI (si no lo quieres, lo quitamos más adelante)
    plan,
  };
}
