// backend/src/services/planDiaEstadoService.js
import { sql } from "../db.js";
import { resolverPlanDia } from "./planificacionResolver.js";

const TZ = "Europe/Madrid";

// Margen legal (MVP fijo; luego configurable por empresa)
export const MARGEN_ANTES_MIN = 15;
export const MARGEN_DESPUES_MIN = 15;

function timeStrToMin(t, tz = TZ) {
  if (!t) return null;

  // Si es Date
  if (t instanceof Date && !Number.isNaN(t.getTime())) {
    const fmt = new Intl.DateTimeFormat("es-ES", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(t);
    const hh = Number(parts.find((p) => p.type === "hour")?.value);
    const mm = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  const s = String(t).trim();

  // Caso HH:MM o HH:MM:SS
  // (acepta también "8:00")
  const m1 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m1) {
    const h = Number(m1[1]);
    const m = Number(m1[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  // Caso ISO / timestamp parseable
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const fmt = new Intl.DateTimeFormat("es-ES", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hh = Number(parts.find((p) => p.type === "hour")?.value);
    const mm = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  return null;
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
function toYMD(fecha, tz = TZ) {
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
    return getYMDInTZ(fecha, tz);
  }
  const s = String(fecha);
  // Si viene ISO, coge YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Último recurso: intentar parsear y formatear en TZ
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return getYMDInTZ(d, tz);
  return null;
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
  const descansos = bloques.filter((b) =>
    ["descanso", "pausa", "comida"].includes(b.tipo),
  );

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
async function getEventoCalendarioEmpresa({ empresaId, fechaYMD }) {
  const rows = await sql`
    SELECT
      tipo,
      nombre,
      descripcion,
      es_laborable,
      origen,
      confirmado
    FROM calendario_empresa_180
    WHERE empresa_id = ${empresaId}
      AND fecha = ${fechaYMD}::date
      AND activo = true
    LIMIT 1
  `;

  return rows[0] || null;
}

async function getAusenciaActiva({ empleadoId, fechaYMD }) {
  const rows = await sql`
    SELECT id, tipo, estado, fecha_inicio, fecha_fin
    FROM ausencias_180
    WHERE empleado_id = ${empleadoId}
      AND estado = 'aprobado'
      AND fecha_inicio <= ${fechaYMD}::date
      AND fecha_fin >= ${fechaYMD}::date
    ORDER BY
      CASE
        WHEN tipo = 'baja_medica' THEN 1
        WHEN tipo = 'vacaciones' THEN 2
        ELSE 3
      END,
      fecha_inicio DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function getPlanDiaEstado({
  empresaId,
  empleadoId,
  fecha,
  now = new Date(),
}) {
  const ymd = toYMD(fecha, TZ);
  if (!ymd) {
    return {
      fecha: null,
      boton_visible: false,
      motivo_oculto: "fecha_invalida",
      plan: null,
    };
  }

  // 1) Ausencia bloqueante
  const ausencia = await getAusenciaActiva({ empleadoId, fechaYMD: ymd });

  if (ausencia && ausenciaBloqueante(ausencia.tipo)) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "ausencia",
      plan: null,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
      ausencia: {
        id: ausencia.id,
        tipo: ausencia.tipo,
        fecha_inicio: ausencia.fecha_inicio,
        fecha_fin: ausencia.fecha_fin,
      },
    };
  }
  // 1.5) Calendario laboral empresa (OCR / manual / API)
  const eventoCal = await getEventoCalendarioEmpresa({
    empresaId,
    fechaYMD: ymd,
  });

  const bloqueaPorCalendario =
    eventoCal &&
    (eventoCal.es_laborable === false ||
      ["festivo_local", "convenio", "cierre_empresa"].includes(eventoCal.tipo));

  if (bloqueaPorCalendario) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "calendario",

      mensaje:
        eventoCal.tipo === "festivo_local"
          ? "Hoy es festivo"
          : eventoCal.tipo === "convenio"
            ? "Día no laborable por convenio"
            : eventoCal.tipo === "cierre_empresa"
              ? "Empresa cerrada"
              : "Día no laborable",

      plan: null,

      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,

      calendario: {
        tipo: eventoCal.tipo,
        nombre: eventoCal.nombre,
        descripcion: eventoCal.descripcion,
        origen: eventoCal.origen,
        confirmado: eventoCal.confirmado,
      },

      ausencia: ausencia
        ? {
            id: ausencia.id,
            tipo: ausencia.tipo,
            fecha_inicio: ausencia.fecha_inicio,
            fecha_fin: ausencia.fecha_fin,
          }
        : null,
    };
  }

  // 2) Plan del día
  const plan = await resolverPlanDia({ empresaId, empleadoId, fecha: ymd });

  const fuerzaLaboral =
    eventoCal &&
    eventoCal.tipo === "laborable_extra" &&
    eventoCal.es_laborable === true;

  const es_laboral = fuerzaLaboral ? true : isDiaLaboral(plan);

  // Normalización de bloques
  // Normalización de bloques (correcta)
  if (Array.isArray(plan?.bloques)) {
    plan.bloques = plan.bloques
      .map((b) => {
        const inicio = b.inicio || b.hora_inicio || null;
        const fin = b.fin || b.hora_fin || null;

        // Mapear pausa/comida → descanso
        const tipoNorm =
          b.tipo === "pausa" || b.tipo === "comida" ? "descanso" : b.tipo;

        return { ...b, inicio, fin, tipo: tipoNorm };
      })
      .sort((a, b) =>
        String(a.inicio || "").localeCompare(String(b.inicio || "")),
      );
  }

  if (!es_laboral) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "no_laboral",
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
      ausencia: ausencia
        ? {
            id: ausencia.id,
            tipo: ausencia.tipo,
            fecha_inicio: ausencia.fecha_inicio,
            fecha_fin: ausencia.fecha_fin,
          }
        : null,
    };
  }

  // 3) Fichajes del día
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
    targets.descanso_inicio && targets.descanso_fin,
  );

  // 3.5) Jornada abierta real (fuente de verdad)
  const [jAbierta] = await sql`
  SELECT id
  FROM jornadas_180
  WHERE empresa_id = ${empresaId}
    AND empleado_id = ${empleadoId}
    AND estado = 'abierta'
  LIMIT 1
`;

  const hayJornadaAbierta = !!jAbierta;

  // 3.6) Acción según fichajes
  let accion = nextAccionFromFichajes(fichajes, hayDescansoPlan);

  // Sin jornada → solo se puede entrar
  if (!hayJornadaAbierta) {
    accion = "entrada";
  }

  // Hay jornada pero no hay fichajes → continuar jornada
  if (hayJornadaAbierta && fichajes.length === 0) {
    accion = hayDescansoPlan ? "descanso_inicio" : "salida";
  }

  // Hay jornada pero los fichajes dicen "entrada" → corregir
  if (hayJornadaAbierta && accion === "entrada") {
    accion = hayDescansoPlan ? "descanso_inicio" : "salida";
  }

  // Jornada cerrada realmente
  if (!accion) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "jornada_finalizada",
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
    };
  }
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

  const objetivoMin = timeStrToMin(objetivoHHMM, TZ);

  if (objetivoMin == null) {
    return {
      fecha: ymd,
      boton_visible: false,
      motivo_oculto: "sin_objetivo",
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
    };
  }

  // 4) Ventana legal
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
    puede_fichar: true,
    fuera_de_margen: !dentro,
    mensaje: !esHoy
      ? "Fecha distinta de hoy"
      : dentro
        ? "Dentro del margen legal de fichaje"
        : "Fuera del margen legal (quedará como incidencia)",

    // decisión
    accion,
    acciones_permitidas: accion ? [accion] : [],
    objetivo_hhmm: objetivoHHMM || null,
    margen_antes: MARGEN_ANTES_MIN,
    margen_despues: MARGEN_DESPUES_MIN,
    motivo_oculto: null,

    // trazabilidad
    es_laboral,
    plan,
    ausencia: ausencia
      ? {
          id: ausencia.id,
          tipo: ausencia.tipo,
          fecha_inicio: ausencia.fecha_inicio,
          fecha_fin: ausencia.fecha_fin,
        }
      : null,
  };
}
// backend/src/services/planDiaEstadoService.js
