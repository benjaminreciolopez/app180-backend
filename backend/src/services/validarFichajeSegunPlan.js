// backend/src/services/validarFichajeSegunPlan.js
import { resolverPlanDia } from "./planificacionResolver.js";

function minutesFromTimeStr(t) {
  // "HH:MM:SS" -> minutos desde 00:00
  const [hh, mm] = String(t).split(":");
  return Number(hh) * 60 + Number(mm);
}

function minutesFromDate(d) {
  return d.getHours() * 60 + d.getMinutes();
}

export async function validarFichajeSegunPlan({
  empresaId,
  empleadoId,
  fechaHora,
  tipo,
}) {
  const fecha = new Date(fechaHora).toISOString().slice(0, 10);
  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha });

  const incidencias = [];

  if (!plan?.plantilla_id) {
    return { ok: true, plan, incidencias: ["Sin plantilla asignada"] };
  }

  // Domingo: si hay plan semanal pero tu empresa quiere domingo no laborable,
  // lo normal es que en plantilla el domingo esté inactivo o sin bloques.
  // Aun así, si hay rango vacío, lo marcamos.
  if (!plan.rango && (!plan.bloques || plan.bloques.length === 0)) {
    incidencias.push("Día sin bloques definidos en plantilla");
    return { ok: true, plan, incidencias };
  }

  const m = minutesFromDate(new Date(fechaHora));

  // Control básico: rango del día
  if (plan.rango?.inicio && plan.rango?.fin) {
    const ini = minutesFromTimeStr(plan.rango.inicio);
    const fin = minutesFromTimeStr(plan.rango.fin);

    if (tipo === "entrada" && m > fin)
      incidencias.push("Entrada después del fin previsto");
    if (tipo === "entrada" && m < ini - 60)
      incidencias.push("Entrada muy temprana vs rango previsto");
    if (tipo === "salida" && m < ini)
      incidencias.push("Salida antes del inicio previsto");
  }

  // Bloques obligatorios: podemos avisar si la entrada cae fuera del primer bloque trabajo
  const bloques = plan.bloques || [];
  const trabajos = bloques.filter((b) => b.tipo === "trabajo");
  if (tipo === "entrada" && trabajos.length) {
    const b0 = trabajos[0];
    const b0i = minutesFromTimeStr(b0.inicio);
    const b0f = minutesFromTimeStr(b0.fin);
    if (m < b0i - 30 || m > b0f)
      incidencias.push("Entrada fuera del primer bloque de trabajo");
  }

  return { ok: true, plan, incidencias };
}
// backend/src/services/dailyReportService.js
