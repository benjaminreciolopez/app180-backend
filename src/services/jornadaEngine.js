// backend/src/services/jornadaEngine.js
import { sql } from "../db.js";
import { calcularMinutos } from "./jornadasCalculo.js";
import { calcularExtras } from "./jornadasExtras.js";
import { resolverPlanDia } from "./planificacionResolver.js";

// convierte Date -> YYYY-MM-DD (local server)
function toYMD(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Devuelve true si el intervalo [start,end] toca la franja nocturna
 * MVP: 22:00–06:00 (local)
 */
function intervalTouchesNocturno(start, end) {
  if (!isValidDate(start) || !isValidDate(end)) return false;

  // si end <= start, no
  if (end <= start) return false;

  // Iteramos por días, chequeando overlap con 22:00-06:00
  // para evitar edge cases de cambio de día.
  const cursor = new Date(start);
  cursor.setSeconds(0, 0);

  // límite de seguridad (intervalos absurdos)
  let guard = 0;

  while (cursor < end && guard < 10) {
    guard++;

    const day = new Date(cursor);
    day.setHours(0, 0, 0, 0);

    const noctStart = new Date(day);
    noctStart.setHours(22, 0, 0, 0);

    // noctEnd es 06:00 del día siguiente
    const noctEnd = new Date(day);
    noctEnd.setDate(noctEnd.getDate() + 1);
    noctEnd.setHours(6, 0, 0, 0);

    const a = start > noctStart ? start : noctStart;
    const b = end < noctEnd ? end : noctEnd;

    if (a < b) return true;

    // saltamos al siguiente día
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return false;
}

/**
 * Construye bloques reales a partir de fichajes ordenados:
 * - trabajo: entrada->salida
 * - descanso: descanso_inicio->descanso_fin
 *
 * No cierra ni inventa pares. Si falta cierre, se ignora el bloque incompleto.
 */
function construirBloquesReales(fichajes) {
  const bloques = [];
  let trabajoInicio = null;
  let descansoInicio = null;

  for (const f of fichajes) {
    const t = f.tipo;
    const fecha = new Date(f.fecha);

    if (!isValidDate(fecha)) continue;

    if (t === "entrada") {
      if (!trabajoInicio) trabajoInicio = fecha;
    }

    if (t === "salida") {
      if (trabajoInicio) {
        bloques.push({
          tipo: "trabajo",
          inicio: trabajoInicio.toISOString(),
          fin: fecha.toISOString(),
          minutos: calcularMinutos(trabajoInicio, fecha),
          ubicacion: f.ubicacion ?? null,
        });
        trabajoInicio = null;
      }
    }

    if (t === "descanso_inicio") {
      if (!descansoInicio) descansoInicio = fecha;
    }

    if (t === "descanso_fin") {
      if (descansoInicio) {
        bloques.push({
          tipo: "descanso",
          inicio: descansoInicio.toISOString(),
          fin: fecha.toISOString(),
          minutos: calcularMinutos(descansoInicio, fecha),
          ubicacion: f.ubicacion ?? null,
        });
        descansoInicio = null;
      }
    }
  }

  bloques.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  return bloques;
}

function sumarMinutos(bloques, tipo) {
  return bloques
    .filter((b) => b.tipo === tipo)
    .reduce((acc, b) => acc + (b.minutos || 0), 0);
}

function toMinutesFromHours(h) {
  if (h == null) return null;
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}
function timeStrToMin(t) {
  if (!t) return null;
  const [hh, mm] = String(t).split(":");
  if (hh == null || mm == null) return null;
  return Number(hh) * 60 + Number(mm);
}

function isoToLocalMin(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

async function getTurnoEmpleado({ empresaId, empleadoId }) {
  const rows = await sql`
    SELECT
      t.id,
      t.nombre,
      t.horas_dia_objetivo,
      t.max_horas_dia,
      t.max_horas_semana,
      t.minutos_descanso_min,
      t.minutos_descanso_max,
      t.nocturno_permitido
    FROM employees_180 e
    LEFT JOIN turnos_180 t ON t.id = e.turno_id
    WHERE e.id = ${empleadoId}
      AND e.empresa_id = ${empresaId}
      AND (t.activo = true OR t.id IS NULL)
    LIMIT 1
  `;

  const t = rows[0] || null;
  if (!t?.id) return null;

  return {
    id: t.id,
    nombre: t.nombre ?? null,
    horas_dia_objetivo: t.horas_dia_objetivo ?? null,
    max_horas_dia: t.max_horas_dia ?? null,
    max_horas_semana: t.max_horas_semana ?? null,
    minutos_descanso_min: t.minutos_descanso_min ?? null,
    minutos_descanso_max: t.minutos_descanso_max ?? null,
    nocturno_permitido: t.nocturno_permitido ?? null,
  };
}

function pushAviso(avisos, aviso) {
  // normalización mínima
  if (!aviso?.tipo || !aviso?.mensaje) return;
  avisos.push({
    tipo: aviso.tipo,
    nivel: aviso.nivel || "info", // info | warning | danger
    mensaje: aviso.mensaje,
    meta: aviso.meta || null,
  });
}

function compararPlanVsReal({ plan, bloquesReales }) {
  const desviaciones = [];
  const metricas = {
    minutos_trabajo_en_bloque: 0,
    minutos_trabajo_fuera_bloque: 0,
    minutos_descanso_en_bloque: 0,
    minutos_descanso_fuera_bloque: 0,
    retraso_min: 0,
    salida_anticipada_min: 0,
    minutos_planificados_trabajo: 0,
    minutos_planificados_descanso: 0,
  };

  const esp = plan?.bloques || [];
  const trabajosEsp = esp.filter((b) => b.tipo === "trabajo");
  const descansosEsp = esp.filter((b) => String(b.tipo).includes("descanso"));

  // Totales planificados
  for (const b of trabajosEsp) {
    const i = timeStrToMin(b.inicio);
    const f = timeStrToMin(b.fin);
    if (i != null && f != null && f > i)
      metricas.minutos_planificados_trabajo += f - i;
  }
  for (const b of descansosEsp) {
    const i = timeStrToMin(b.inicio);
    const f = timeStrToMin(b.fin);
    if (i != null && f != null && f > i)
      metricas.minutos_planificados_descanso += f - i;
  }

  // Si no hay bloques esperados, no podemos medir “en/fuera”
  if (!esp.length) {
    if (plan?.plantilla_id) {
      desviaciones.push({
        tipo: "sin_bloques_plan",
        nivel: "warning",
        mensaje: "Plantilla asignada pero sin bloques para ese día",
      });
    }
    return { desviaciones, metricas };
  }

  // Detectar retraso / salida anticipada respecto al primer/último bloque de trabajo
  if (trabajosEsp.length) {
    const first = trabajosEsp[0];
    const last = trabajosEsp[trabajosEsp.length - 1];
    const planIni = timeStrToMin(first.inicio);
    const planFin = timeStrToMin(last.fin);

    const primerTrabajoReal = bloquesReales.find((b) => b.tipo === "trabajo");
    const ultimoTrabajoReal = [...bloquesReales]
      .reverse()
      .find((b) => b.tipo === "trabajo");

    if (planIni != null && primerTrabajoReal) {
      const realIni = isoToLocalMin(primerTrabajoReal.inicio);
      if (realIni > planIni) {
        metricas.retraso_min = realIni - planIni;
        desviaciones.push({
          tipo: "entrada_tarde",
          nivel: "warning",
          mensaje: "Entrada posterior al inicio planificado",
          meta: {
            plan_ini_min: planIni,
            real_ini_min: realIni,
            retraso_min: metricas.retraso_min,
          },
        });
      }
    }

    if (planFin != null && ultimoTrabajoReal) {
      const realFin = isoToLocalMin(ultimoTrabajoReal.fin);
      if (realFin < planFin) {
        metricas.salida_anticipada_min = planFin - realFin;
        desviaciones.push({
          tipo: "salida_anticipada",
          nivel: "warning",
          mensaje: "Salida anterior al fin planificado",
          meta: {
            plan_fin_min: planFin,
            real_fin_min: realFin,
            salida_anticipada_min: metricas.salida_anticipada_min,
          },
        });
      }
    }
  }

  // Medir minutos reales dentro/fuera de bloques esperados por tipo
  for (const br of bloquesReales) {
    const rI = isoToLocalMin(br.inicio);
    const rF = isoToLocalMin(br.fin);
    if (!(rF > rI)) continue;

    // sum overlap con bloques esperados del mismo “grupo”
    const espCandidates =
      br.tipo === "trabajo"
        ? trabajosEsp
        : String(br.tipo).includes("descanso")
          ? descansosEsp
          : esp; // fallback

    let inMin = 0;
    for (const be of espCandidates) {
      const eI = timeStrToMin(be.inicio);
      const eF = timeStrToMin(be.fin);
      if (eI == null || eF == null || !(eF > eI)) continue;
      inMin += overlapMinutes(rI, rF, eI, eF);
    }

    const total = rF - rI;
    const outMin = Math.max(0, total - inMin);

    if (br.tipo === "trabajo") {
      metricas.minutos_trabajo_en_bloque += inMin;
      metricas.minutos_trabajo_fuera_bloque += outMin;
      if (outMin >= 15) {
        desviaciones.push({
          tipo: "trabajo_fuera_bloque",
          nivel: "warning",
          mensaje: "Trabajo fuera de bloques planificados",
          meta: { out_min: outMin },
        });
      }
    } else if (br.tipo === "descanso") {
      metricas.minutos_descanso_en_bloque += inMin;
      metricas.minutos_descanso_fuera_bloque += outMin;
      if (outMin >= 10) {
        desviaciones.push({
          tipo: "descanso_fuera_bloque",
          nivel: "info",
          mensaje: "Descanso fuera de bloques planificados",
          meta: { out_min: outMin },
        });
      }
    }
  }

  // Bloques obligatorios “no cubiertos” (simplificado MVP)
  for (const b of trabajosEsp.filter((x) => x.obligatorio)) {
    const eI = timeStrToMin(b.inicio);
    const eF = timeStrToMin(b.fin);
    if (eI == null || eF == null || !(eF > eI)) continue;

    // ¿hay algún trabajo real que solape al menos 10 min?
    let covered = false;
    for (const br of bloquesReales.filter((x) => x.tipo === "trabajo")) {
      const rI = isoToLocalMin(br.inicio);
      const rF = isoToLocalMin(br.fin);
      if (overlapMinutes(rI, rF, eI, eF) >= 10) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      desviaciones.push({
        tipo: "bloque_obligatorio_no_cubierto",
        nivel: "danger",
        mensaje: "Bloque obligatorio no cubierto por fichajes",
        meta: { inicio: b.inicio, fin: b.fin },
      });
    }
  }

  return { desviaciones, metricas };
}

/**
 * Recalcula una jornada:
 * - Lee jornada + fichajes
 * - Calcula bloques, trabajados, descanso, extras
 * - Trae plan del día (si existe plantilla)
 * - Trae turno del empleado
 * - Genera avisos informativos (no bloqueantes)
 * - Guarda en jornadas_180.resumen_json
 */
export async function recalcularJornada(jornadaId) {
  // 1) Jornada
  const jRows = await sql`
    SELECT id, empresa_id, empleado_id, inicio, fin, fecha, plantilla_id
    FROM jornadas_180
    WHERE id = ${jornadaId}
    LIMIT 1
  `;
  const jornada = jRows[0];
  if (!jornada) return null;

  const fechaDia =
    jornada.fecha || (jornada.inicio ? toYMD(jornada.inicio) : null);

  // 2) Fichajes de la jornada
  const fichajes = await sql`
    SELECT
      f.id,
      f.tipo,
      f.fecha,
      f.sospechoso,
      f.nota,
      f.direccion,
      f.ciudad,
      f.pais
    FROM fichajes_180 f
    WHERE f.jornada_id = ${jornadaId}
    ORDER BY f.fecha ASC
  `;

  // 3) Normalización UI
  const fichajesUI = fichajes.map((f) => ({
    ...f,
    ubicacion:
      [f.direccion, f.ciudad, f.pais].filter(Boolean).join(" · ") || null,
  }));

  // 4) Bloques reales
  const bloquesReales = construirBloquesReales(fichajesUI);

  const minutosTrabajados = sumarMinutos(bloquesReales, "trabajo");
  const minutosDescanso = sumarMinutos(bloquesReales, "descanso");

  // 5) Planificación (si existe plantilla)
  const plan = fechaDia
    ? await resolverPlanDia({
        empresaId: jornada.empresa_id,
        empleadoId: jornada.empleado_id,
        fecha: fechaDia,
      })
    : { plantilla_id: null, fecha: fechaDia, bloques: [] };

  // 6) Turno (si existe)
  const turno = await getTurnoEmpleado({
    empresaId: jornada.empresa_id,
    empleadoId: jornada.empleado_id,
  });

  // 7) Avisos informativos (B: tipados)
  const avisos = [];

  // 7.1) Avisos por planificación (lo que ya tenías, pero tipado)
  const descansosEsperados = (plan?.bloques || []).filter((b) =>
    String(b.tipo).includes("descanso")
  );

  if (descansosEsperados.length > 0 && minutosDescanso === 0) {
    pushAviso(avisos, {
      tipo: "descanso_no_registrado",
      nivel: "warning",
      mensaje: "No se ha registrado descanso",
      meta: { descansos_esperados: descansosEsperados.length },
    });
  }

  if (bloquesReales.length === 0) {
    pushAviso(avisos, {
      tipo: "sin_bloques_trabajo",
      nivel: "warning",
      mensaje: "No hay bloques de trabajo detectados",
    });
  }

  // 7.2) Avisos por turno (informativos)
  if (!turno) {
    pushAviso(avisos, {
      tipo: "sin_turno",
      nivel: "info",
      mensaje: "Empleado sin turno asignado",
    });
  } else {
    // objetivo (horas_dia_objetivo) -> minutos
    const objetivoMin = toMinutesFromHours(turno.horas_dia_objetivo);
    if (objetivoMin != null && minutosTrabajados < objetivoMin) {
      pushAviso(avisos, {
        tipo: "objetivo_no_cumplido",
        nivel: "warning",
        mensaje: "No se alcanzan las horas objetivo del turno",
        meta: {
          objetivo_min: objetivoMin,
          trabajados_min: minutosTrabajados,
          diferencia_min: objetivoMin - minutosTrabajados,
        },
      });
    }

    // máximo diario (max_horas_dia)
    const maxDiaMin = toMinutesFromHours(turno.max_horas_dia);
    if (maxDiaMin != null && minutosTrabajados > maxDiaMin) {
      pushAviso(avisos, {
        tipo: "max_diario_superado",
        nivel: "danger",
        mensaje: "Se supera el máximo diario definido por el turno",
        meta: {
          max_min: maxDiaMin,
          trabajados_min: minutosTrabajados,
          exceso_min: minutosTrabajados - maxDiaMin,
        },
      });
    }

    // descanso mínimo / máximo
    if (
      turno.minutos_descanso_min != null &&
      minutosDescanso < Number(turno.minutos_descanso_min)
    ) {
      pushAviso(avisos, {
        tipo: "descanso_min_no_cumplido",
        nivel: "warning",
        mensaje: "Descanso inferior al mínimo del turno",
        meta: {
          min_min: Number(turno.minutos_descanso_min),
          descanso_min: minutosDescanso,
          diferencia_min: Number(turno.minutos_descanso_min) - minutosDescanso,
        },
      });
    }

    if (
      turno.minutos_descanso_max != null &&
      minutosDescanso > Number(turno.minutos_descanso_max)
    ) {
      pushAviso(avisos, {
        tipo: "descanso_max_superado",
        nivel: "warning",
        mensaje: "Descanso superior al máximo del turno",
        meta: {
          max_min: Number(turno.minutos_descanso_max),
          descanso_min: minutosDescanso,
          exceso_min: minutosDescanso - Number(turno.minutos_descanso_max),
        },
      });
    }

    // nocturnidad real: detectamos si algún bloque de trabajo toca 22:00-06:00
    const hayTrabajoNocturno = bloquesReales.some((b) => {
      if (b.tipo !== "trabajo") return false;
      const s = new Date(b.inicio);
      const e = new Date(b.fin);
      return intervalTouchesNocturno(s, e);
    });

    if (hayTrabajoNocturno && turno.nocturno_permitido !== true) {
      pushAviso(avisos, {
        tipo: "nocturno_no_permitido",
        nivel: "warning",
        mensaje: "Trabajo nocturno no permitido por el turno",
        meta: { nocturno_permitido: turno.nocturno_permitido },
      });
    }
  }

  // 8) Extras (MVP: por objetivo del turno si existe; fallback 8h)
  const objetivoMinParaExtras =
    turno && turno.horas_dia_objetivo != null
      ? toMinutesFromHours(turno.horas_dia_objetivo)
      : 8 * 60;

  const minutosExtra = calcularExtras({
    minutos_trabajados: minutosTrabajados,
    horas_objetivo_dia: Math.round((objetivoMinParaExtras || 480) / 60),
  });
  const { desviaciones, metricas } = compararPlanVsReal({
    plan,
    bloquesReales,
  });

  // 9) Resumen JSON (clave para frontend)
  const resumen = {
    fecha: fechaDia,
    turno: turno
      ? {
          id: turno.id,
          nombre: turno.nombre,
          horas_dia_objetivo: turno.horas_dia_objetivo,
          max_horas_dia: turno.max_horas_dia,
          max_horas_semana: turno.max_horas_semana,
          minutos_descanso_min: turno.minutos_descanso_min,
          minutos_descanso_max: turno.minutos_descanso_max,
          nocturno_permitido: turno.nocturno_permitido,
        }
      : null,
    plantilla_id: plan?.plantilla_id ?? null,
    plan_modo: plan?.modo ?? null,
    rango_esperado: plan?.rango ?? null,
    bloques_esperados: plan?.bloques ?? [],

    bloques_reales: bloquesReales,
    minutos_trabajados: minutosTrabajados,
    minutos_descanso: minutosDescanso,
    minutos_extra: minutosExtra,

    desviaciones,
    metricas,
    avisos,
  };

  // 10) Persistir en jornada
  const up = await sql`
    UPDATE jornadas_180
    SET
      minutos_trabajados = ${minutosTrabajados},
      minutos_descanso = ${minutosDescanso},
      minutos_extra = ${minutosExtra},
      resumen_json = ${JSON.stringify(resumen)}::jsonb,
      plantilla_id = ${plan?.plantilla_id ?? null},
      updated_at = NOW()
    WHERE id = ${jornadaId}
    RETURNING *
  `;

  return up[0] || null;
}
