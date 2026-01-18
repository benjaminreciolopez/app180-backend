// backend/src/services/planDiaEstadoService.js
import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";

const TZ = "Europe/Madrid";

// Margen legal (MVP fijo; luego configurable por empresa)
export const MARGEN_ANTES_MIN = 15;
export const MARGEN_DESPUES_MIN = 15;

function timeStrToMin(t) {
  if (!t) return null;
  const [hh, mm] = String(t).split(":");
  if (hh == null || mm == null) return null;
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function getYMDInTZ(date, tz = TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // YYYY-MM-DD
}

function getNowMinInTZ(date, tz = TZ) {
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hh = Number(parts.find((p) => p.type === "hour")?.value);
  const mm = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function isDiaLaboral(plan) {
  const bloques = Array.isArray(plan?.bloques) ? plan.bloques : [];
  const hayTrabajo = bloques.some((b) => b.tipo === "trabajo");
  const hayRango = !!(plan?.rango?.inicio && plan?.rango?.fin);
  return hayTrabajo || hayRango;
}

function pickTargetsFromPlan(plan) {
  const bloques = Array.isArray(plan?.bloques) ? plan.bloques : [];
  const trabajos = bloques.filter((b) => b.tipo === "trabajo");
  const descansos = bloques.filter((b) => String(b.tipo).includes("descanso"));

  const entrada =
    trabajos.length > 0 ? trabajos[0].inicio : plan?.rango?.inicio || null;

  const salida =
    trabajos.length > 0
      ? trabajos[trabajos.length - 1].fin
      : plan?.rango?.fin || null;

  const descanso_inicio = descansos.length > 0 ? descansos[0].inicio : null;
  const descanso_fin = descansos.length > 0 ? descansos[0].fin : null;

  return {
    entrada,
    descanso_inicio,
    descanso_fin,
    salida,
    trabajos,
    descansos,
  };
}

function windowForTarget(targetMin) {
  if (targetMin == null) return null;
  return {
    objetivo_min: targetMin,
    inicio_min: targetMin - MARGEN_ANTES_MIN,
    fin_min: targetMin + MARGEN_DESPUES_MIN,
  };
}

function withinWindow(nowMin, win) {
  if (nowMin == null || !win) return false;
  return nowMin >= win.inicio_min && nowMin <= win.fin_min;
}

function nextAccionFromFichajes(fichajes, hayDescansoPlan) {
  if (!Array.isArray(fichajes) || fichajes.length === 0) return "entrada";

  const last = fichajes[fichajes.length - 1]?.tipo;

  if (last === "entrada") return hayDescansoPlan ? "descanso_inicio" : "salida";
  if (last === "descanso_inicio") return "descanso_fin";
  if (last === "descanso_fin") return "salida";
  if (last === "salida") return null;

  return "entrada";
}

function ausenciaBloqueante(tipo) {
  return tipo === "vacaciones" || tipo === "baja_medica";
}

async function getAusenciaActiva({ empleadoId, fechaYMD }) {
  const rows = await sql`
    SELECT id, tipo, estado, fecha_inicio, fecha_fin
    FROM ausencias_180
    WHERE empleado_id = ${empleadoId}
      AND estado = 'aprobado'
      AND fecha_inicio <= ${fechaYMD}::date
      AND fecha_fin >= ${fechaYMD}::date
    ORDER BY fecha_inicio DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getPlanDiaEstado({
  empresaId,
  empleadoId,
  fecha, // YYYY-MM-DD (o ISO; se normaliza)
  now = new Date(),
}) {
  const ymd = String(fecha).slice(0, 10);

  // 1) Ausencia bloqueante
  const ausencia = await getAusenciaActiva({ empleadoId, fechaYMD: ymd });
  if (ausencia && ausenciaBloqueante(String(ausencia.tipo))) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "ausencia",
      ausencia: {
        id: ausencia.id,
        tipo: ausencia.tipo,
        fecha_inicio: ausencia.fecha_inicio,
        fecha_fin: ausencia.fecha_fin,
      },
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
    };
  }

  // 2) Plan del día (plantilla/excepción/semanal)
  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha: ymd });
  const es_laboral = isDiaLaboral(plan);

  // Si no es laboral (incluye festivo sin trabajo, domingo libre, etc.) => oculto
  if (!es_laboral) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "no_laboral",
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
    };
  }

  // 3) Fichajes del día (para decidir acción)
  const fichajes = await sql`
    SELECT tipo, fecha
    FROM fichajes_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND fecha::date = ${ymd}::date
    ORDER BY fecha ASC
  `;

  const targets = pickTargetsFromPlan(plan);
  const hayDescansoPlan = Boolean(
    targets.descanso_inicio && targets.descanso_fin
  );

  const accion = nextAccionFromFichajes(fichajes, hayDescansoPlan);

  const objetivoHHMM =
    accion === "entrada"
      ? targets.entrada
      : accion === "descanso_inicio"
        ? targets.descanso_inicio
        : accion === "descanso_fin"
          ? targets.descanso_fin
          : accion === "salida"
            ? targets.salida
            : null;

  const objetivoMin = timeStrToMin(objetivoHHMM);

  // 4) Ventana legal y estado (solo habilita si es HOY en Europe/Madrid)
  const hoyYMD = getYMDInTZ(now, TZ);
  const nowMin = getNowMinInTZ(now, TZ);
  const esHoy = hoyYMD === ymd;

  const win = windowForTarget(objetivoMin);
  const dentro = Boolean(esHoy && accion && win && withinWindow(nowMin, win));

  return {
    fecha: ymd,
    boton_visible: true,

    // UI
    color: dentro ? "rojo" : "negro",
    puede_fichar: Boolean(dentro),
    mensaje: !esHoy
      ? "Fecha distinta de hoy"
      : !accion
        ? "Jornada finalizada"
        : dentro
          ? "Dentro del margen legal de fichaje"
          : "Fuera del margen legal de fichaje",

    // decisión
    accion, // entrada|descanso_inicio|descanso_fin|salida|null
    objetivo_hhmm: objetivoHHMM || null,
    margen_antes: MARGEN_ANTES_MIN,
    margen_despues: MARGEN_DESPUES_MIN,
    motivo_oculto: null,

    // trazabilidad (opcional para depurar)
    es_laboral,
    plan,
    ausencia: ausencia ? { id: ausencia.id, tipo: ausencia.tipo } : null,
  };
}
// backend/src/services/planDiaEstadoService.js
