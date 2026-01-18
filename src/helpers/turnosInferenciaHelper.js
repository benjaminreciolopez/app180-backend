// backend/src/helpers/turnosInferenciaHelper.js

function pickInicio(b) {
  return (b?.hora_inicio ?? b?.inicio ?? "").toString().slice(0, 8);
}

function pickFin(b) {
  return (b?.hora_fin ?? b?.fin ?? "").toString().slice(0, 8);
}

function cmp(a, b) {
  return String(a).localeCompare(String(b));
}

/**
 * Inferencia robusta a partir de bloques planificados.
 * - nocturno: cualquier bloque cruza medianoche (fin < inicio)
 * - partido: más de un bloque de "trabajo"
 * - completo: un bloque de "trabajo"
 * - otros: fallback
 */
export function inferirTipoTurnoDesdePlan(plan) {
  const bloquesRaw =
    plan?.plan?.bloques || plan?.bloques || plan?.planificacion?.bloques || [];

  if (!Array.isArray(bloquesRaw) || bloquesRaw.length === 0) return "otros";

  const bloques = bloquesRaw
    .map((b) => ({
      tipo: (b?.tipo ?? "").toString().toLowerCase(),
      inicio: pickInicio(b),
      fin: pickFin(b),
    }))
    .filter((b) => b.inicio && b.fin)
    .sort((a, b) => cmp(a.inicio, b.inicio));

  if (bloques.length === 0) return "otros";

  // Cruza medianoche => nocturno
  if (bloques.some((b) => cmp(b.fin, b.inicio) < 0)) return "nocturno";

  // Contar solo bloques de trabajo
  const trabajos = bloques.filter((b) => b.tipo === "trabajo");

  if (trabajos.length >= 2) return "partido";
  if (trabajos.length === 1) return "completo";

  // Si no hay "trabajo" explícito, decide por cantidad de bloques
  if (bloques.length >= 2) return "partido";
  return "completo";
}
