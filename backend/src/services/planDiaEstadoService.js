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
  // Si hay rango definido (hora inicio y fin), es laboral
  const hayRango = !!(plan?.rango?.inicio && plan?.rango?.fin);
  
  // Si hay bloques definidos (cualquier tipo de bloque implica actividad)
  const bloques = Array.isArray(plan?.bloques) ? plan.bloques : [];
  const hayBloques = bloques.length > 0;

  return hayRango || hayBloques;
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


  // 🔧 Normalizar bloques ANTES de evaluar si es laboral
  if (Array.isArray(plan?.bloques)) {
    plan.bloques = plan.bloques
      .map((b) => ({
        ...b,
        tipo: b.tipo === "pausa" || b.tipo === "comida" ? "descanso" : b.tipo,
      }))
      .sort((a, b) =>
        String(a.inicio || "").localeCompare(String(b.inicio || "")),
      );
  }

  // 2.1) Cliente asignado (work context / geocerca)
  // Intentar obtener de la asignación de jornada
  const asigCliente = await sql`
    SELECT
      a.cliente_id,
      c.nombre as cliente_nombre,
      c.lat as cliente_lat,
      c.lng as cliente_lng,
      c.radio_m as cliente_radio_m,
      c.geo_policy as cliente_geo_policy,
      c.modo_defecto as cliente_modo_defecto
    FROM asignaciones_plantilla_jornada_180 a
    LEFT JOIN clients_180 c ON c.id = a.cliente_id
    WHERE a.empleado_id = ${empleadoId}
      AND a.empresa_id = ${empresaId}
      AND a.activo = true
      AND a.fecha_inicio <= ${ymd}::date
      AND (a.fecha_fin IS NULL OR a.fecha_fin >= ${ymd}::date)
    ORDER BY a.fecha_inicio DESC
    LIMIT 1
  `;

  let datosCliente = null;

  // Si hay cliente en la jornada, usarlo
  if (asigCliente && asigCliente.length > 0 && asigCliente[0].cliente_id) {
      datosCliente = asigCliente[0];
  } else {
      // ⚠️ FALLBACK: Si no hay cliente en jornada, buscar CLIENTE ACTUAL desde asignaciones de Jornadas
      const clienteActual = await sql`
        SELECT 
            ec.cliente_id,
            c.nombre as cliente_nombre,
            c.lat as cliente_lat,
            c.lng as cliente_lng,
            c.radio_m as cliente_radio_m,
            c.geo_policy as cliente_geo_policy,
            c.modo_defecto as cliente_modo_defecto
        FROM empleado_clientes_180 ec
        JOIN clients_180 c ON c.id = ec.cliente_id
        JOIN employees_180 e ON e.id = ec.empleado_id
        WHERE ec.empleado_id = ${empleadoId}
          AND ec.fecha_fin IS NULL
          AND e.empresa_id = ec.empresa_id
        LIMIT 1
      `;
      
      if (clienteActual.length > 0 && clienteActual[0].cliente_id) {
          datosCliente = clienteActual[0];
      }
  }

  const cliente = datosCliente
    ? {
        id: datosCliente.cliente_id, // o cliente_defecto_id, que mapeamos arriba
        nombre: datosCliente.cliente_nombre ?? null,
        lat: datosCliente.cliente_lat ?? null,
        lng: datosCliente.cliente_lng ?? null,
        radio_m: datosCliente.cliente_radio_m ?? null,
        geo_policy: datosCliente.cliente_geo_policy ?? null,
        modo_defecto: datosCliente.cliente_modo_defecto ?? null,
      }
    : null;

  const fuerzaLaboral =
    eventoCal &&
    eventoCal.tipo === "laborable_extra" &&
    eventoCal.es_laborable === true;

  // ✅ AHORA sí: bloques ya existen
  const es_laboral = fuerzaLaboral ? true : isDiaLaboral(plan);

  // Si detectamos ausencia, TIENE PRIORIDAD y bloquea/oculta según lógica
  if (ausencia && ausenciaBloqueante(ausencia.tipo)) {
     const labels = {
         vacaciones: "Estás de vacaciones",
         baja_medica: "Estás de baja médica",
         permiso: "Estás de permiso"
     };
     return {
      fecha: ymd,
      boton_visible: false, 
      motivo_oculto: "ausencia",
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
      mensaje: labels[ausencia.tipo] || "Ausencia activa",
      ausencia: {
        id: ausencia.id,
        tipo: ausencia.tipo,
        fecha_inicio: ausencia.fecha_inicio,
        fecha_fin: ausencia.fecha_fin,
      },
    };
  }

  // 3) Fichajes del día (MOVIDO ANTES DEL CHECK LABORAL)
  const fichajes = await sql`
    SELECT tipo, fecha
    FROM fichajes_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND fecha::date = ${ymd}::date
    ORDER BY fecha ASC
  `;

  // Comportamiento "Día no laboral" (sin ausencia ni festivo, simplemente no hay horario)
  if (!es_laboral) {
    // CAMBIO CLAVE: Si ya hay fichajes, calculamos la acción siguiente real
    // Si no hay fichajes, por defecto es entrada.
    const accionExtra = nextAccionFromFichajes(fichajes, false); // false = no hay descansos planificados

    // Mensaje dinámico
    let msgExtra = "Día sin horario planificado (fichaje extra)";
    if (accionExtra === "salida") msgExtra = "Estás trabajando fuera de horario";
    
    return {
      fecha: ymd,
      boton_visible: true, 
      motivo_oculto: null,
      
      plan,
      margen_antes: MARGEN_ANTES_MIN,
      margen_despues: MARGEN_DESPUES_MIN,
      
      color: "negro",
      can_fichar: true,
      puede_fichar: true,
      
      mensaje: msgExtra,
      
      accion: accionExtra || "entrada", // si devuelve null (ya salió), poner entrada? O null?
      acciones_permitidas: accionExtra ? [accionExtra] : ["entrada"],
      
      ausencia: null,
    };
  }

  // 3) Fichajes del día -> YA OBTENIDOS ARRIBA

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

  // 3.6) Acción según fichajes (regla legal)
  let accion;

  if (!fichajes || fichajes.length === 0) {
    accion = "entrada";
  } else {
    accion = nextAccionFromFichajes(fichajes, hayDescansoPlan);
  }

  // Si el último fichaje fue salida, comprobar reentrada
  if (!accion) {
    const salidaObj = targets.salida ? timeStrToMin(targets.salida, TZ) : null;
    const ahoraMin = getNowMinInTZ(now, TZ);

    // Si aún estamos dentro del turno (+ margen) → permitir nueva entrada
    if (
      salidaObj != null &&
      ahoraMin != null &&
      ahoraMin < salidaObj + MARGEN_DESPUES_MIN
    ) {
      accion = "entrada";
    } else {
      // Turno realmente finalizado
      return {
        fecha: ymd,
        boton_visible: false,
        motivo_oculto: "jornada_finalizada",
        mensaje: "Jornada finalizada",
        plan,
        margen_antes: MARGEN_ANTES_MIN,
        margen_despues: MARGEN_DESPUES_MIN,
      };
    }
  }

  const nowMin = getNowMinInTZ(now, TZ);
  let objetivoHHMM = null;
  
  if (accion === "entrada") {
    objetivoHHMM = targets.entrada;
  } else if (accion === "salida") {
    objetivoHHMM = targets.salida;
  } else if (accion === "descanso_inicio") {
      // Buscar el descanso más apropiado (el que esté en curso o el siguiente más cercano)
      // Si hay múltiples, cogemos el primero cuyo FIN no haya pasado (o margen). 
      // Si todos pasaron, cogemos el último.
      const cand = targets.descansos.find(d => {
          const finMin = timeStrToMin(d.fin, TZ);
          return finMin != null && (finMin + MARGEN_DESPUES_MIN) > nowMin;
      });
      objetivoHHMM = cand ? cand.inicio : (targets.descansos[targets.descansos.length - 1]?.inicio);
      
  } else if (accion === "descanso_fin") {
      // Buscar el descanso cuyo inicio ya pasó pero estamos antes del fin (o cerca)
      // O simplemente el más cercano a "ahora"
      const cand = targets.descansos.find(d => {
          const iniMin = timeStrToMin(d.inicio, TZ);
          const finMin = timeStrToMin(d.fin, TZ);
          // Estamos "dentro" o cerca del fin
          return finMin != null && (finMin + MARGEN_DESPUES_MIN) > nowMin;
      });
      objetivoHHMM = cand ? cand.fin : (targets.descansos[targets.descansos.length - 1]?.fin);
  }

  const objetivoMin = timeStrToMin(objetivoHHMM, TZ);

  // 4) Ventana legal y Visibilidad
  const hoyYMD = getYMDInTZ(now, TZ);
  // const nowMin movemos arriba
  const esHoy = hoyYMD === ymd;

  let dentroMargen = false;
  let mensajeEstado = "";
  
  // Si no hay objetivo (ej. no hay bloques pero isDiaLaboral dio true por rango raro),
  // tratamos como fichaje generico
  if (objetivoMin == null) {
      mensajeEstado = "Fichaje disponible";
      dentroMargen = false;
  } else if (esHoy && nowMin != null) {
    const win = windowForTarget(objetivoMin);
    dentroMargen = withinWindow(nowMin, win);
    
    // Mensajes específicos solicitados
    const diff = objetivoMin - nowMin;
    if (diff > MARGEN_ANTES_MIN) {
      mensajeEstado = `Faltan ${Math.floor(diff / 60)}h ${diff % 60}m para tu jornada`;
    } else if (diff < -MARGEN_DESPUES_MIN) {
       mensajeEstado = "Has pasado la hora prevista";
    } else {
       // Dentro de ventana (aprox)
       if (accion === 'entrada') mensajeEstado = "Es hora de entrar";
       else if (accion === 'salida') mensajeEstado = "Es hora de salir";
       else if (accion.includes('descanso')) mensajeEstado = "Hora de descanso";
       else mensajeEstado = "Es hora de fichar";
    }
  } else {
      mensajeEstado = "Fecha distinta de hoy";
  }

  // REGLA DE NEGOCIO: Botón siempre visible salvo bloqueo por calendario/ausencia
  return {
    fecha: ymd,
    boton_visible: true, 
    cliente,
    
    // UI: Destacar solo cuando es el momento
    color: dentroMargen ? "rojo" : "negro",
    
    can_fichar: true,
    puede_fichar: true,
    
    fuera_de_margen: !dentroMargen,
    mensaje: mensajeEstado,

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
    ausencia: null,
  };
}
// backend/src/services/planDiaEstadoService.js
