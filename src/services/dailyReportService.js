// src/services/dailyReportService.js
import { sql } from "../db.js"; // ajusta a tu ruta real

function toDateOnlyYYYYMMDD(d) {
  // d puede ser Date o string YYYY-MM-DD
  if (typeof d === "string") return d;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function minutesToHoursDecimal(min) {
  if (min == null) return null;
  return Math.round((min / 60) * 100) / 100; // 2 decimales
}

function buildResumenFromFichajes(fichajes) {
  if (!Array.isArray(fichajes) || fichajes.length === 0) return "Sin fichajes";

  // fichajes vienen ordenados asc
  const parts = fichajes.map((f) => {
    const dt = f.fecha ? new Date(f.fecha) : null;
    const hhmm = dt
      ? dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
      : "--:--";
    return `${f.tipo} ${hhmm}`;
  });

  return parts.join(" · ");
}

function pickClienteFromWorkLogs(workLogs) {
  if (!Array.isArray(workLogs) || workLogs.length === 0) return null;

  const count = new Map();

  for (const w of workLogs) {
    if (!w.cliente_id) continue;

    count.set(w.cliente_id, (count.get(w.cliente_id) || 0) + 1);
  }

  let best = null;
  let bestN = 0;

  for (const [cid, n] of count.entries()) {
    if (n > bestN) {
      bestN = n;
      best = cid;
    }
  }

  return best;
}

/**
 * Sincroniza/crea el parte diario (partes_dia_180)
 * Es idempotente y seguro para llamarlo tras cada fichaje o work_log.
 */
export async function syncDailyReport({
  empresaId,
  empleadoId,
  fecha, // YYYY-MM-DD o Date
}) {
  const day = toDateOnlyYYYYMMDD(fecha);

  // 1) Jornada del día
  const jornadas = await sql`
    SELECT *
    FROM jornadas_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND fecha = ${day}::date
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const jornada = jornadas[0] || null;

  // 2) Fichajes del día
  const fichajes = await sql`
    SELECT id, tipo, fecha, sospechoso, nota, origen, creado_manual
    FROM fichajes_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND fecha::date = ${day}::date
    ORDER BY fecha ASC
  `;

  // 3) Work logs del día (clave para análisis de rentabilidad/autónomo)
  const workLogs = await sql`
    SELECT id, cliente_id, fecha, precio, minutos, descripcion
    FROM work_logs_180
    WHERE employee_id = ${empleadoId}
      AND fecha::date = ${day}::date
    ORDER BY fecha ASC
  `;

  // 4) Ausencias del día (si existen)
  const aus = await sql`
    SELECT id, tipo, estado
    FROM ausencias_180
    WHERE empresa_id = ${empresaId}
      AND empleado_id = ${empleadoId}
      AND ${day}::date BETWEEN fecha_inicio AND fecha_fin
    ORDER BY creado_en DESC
    LIMIT 1
  `;
  const ausencia = aus[0] || null;

  // 5) Cálculo horas
  let horas_trabajadas = null;

  if (ausencia) {
    horas_trabajadas = 0;
  } else if (jornada && jornada.minutos_trabajados != null) {
    horas_trabajadas = minutesToHoursDecimal(jornada.minutos_trabajados);
  } else if (jornada && jornada.inicio) {
    // Jornada abierta: cálculo parcial
    const inicio = new Date(jornada.inicio);
    const now = new Date();
    const diffMin = Math.max(0, Math.round((now - inicio) / 60000));
    horas_trabajadas = minutesToHoursDecimal(diffMin);
  } else if (workLogs.length > 0) {
    // VISIÓN RENTABILIDAD: Si no hay fichajes, extraemos el tiempo de los trabajos registrados
    const totalMinutosTrabajos = workLogs.reduce((acc, w) => acc + (Number(w.minutos) || 0), 0);
    horas_trabajadas = minutesToHoursDecimal(totalMinutosTrabajos);
  } else {
    horas_trabajadas = 0;
  }

  // 6) Estado
  let estado = "completo";

  if (ausencia) {
    estado = "ausente";
  } else if (!jornada && workLogs.length > 0) {
    estado = "solo_trabajo";
  } else if (jornada && jornada.estado) {
    const j = String(jornada.estado).toLowerCase();
    estado = j.includes("abiert") ? "abierto" : "completo";
  } else if (!jornada && fichajes.length > 0) {
    estado = "incompleto";
  }

  // si hay sospechosos, incidencias
  if (!ausencia && fichajes.some((f) => f.sospechoso === true)) {
    estado = "incidencia";
  }

  // 7) Resumen + cliente
  const resumenBase = buildResumenFromFichajes(fichajes);
  const cliente_id = pickClienteFromWorkLogs(workLogs);

  // Mejorar el resumen si proceden de worklogs (para auditoría de tiempos)
  let resumenFinal = resumenBase;
  if (ausencia) {
    resumenFinal = `Ausencia: ${ausencia.tipo} (${ausencia.estado})`;
  } else if (workLogs.length > 0) {
    const descripciones = workLogs.map(w => w.descripcion).join(" | ");
    if (fichajes.length === 0) {
      resumenFinal = `[TIEMPOS ESTIMADOS] ${descripciones}`;
    } else {
      resumenFinal = `${resumenBase} || Trabajos: ${descripciones}`;
    }
  }

  // 8) UPSERT en partes_dia_180 (unique empresa_id, empleado_id, fecha)
  const upsert = await sql`
    INSERT INTO partes_dia_180 (
      empleado_id,
      empresa_id,
      fecha,
      resumen,
      horas_trabajadas,
      cliente_id,
      estado,
      created_at,
      updated_at
    )
    VALUES (
      ${empleadoId},
      ${empresaId},
      ${day}::date,
      ${resumenFinal},
      ${horas_trabajadas},
      ${cliente_id},
      ${estado},
      now(),
      now()
    )
    ON CONFLICT (empresa_id, empleado_id, fecha)
    DO UPDATE SET
      resumen = EXCLUDED.resumen,
      horas_trabajadas = EXCLUDED.horas_trabajadas,
      cliente_id = EXCLUDED.cliente_id,
      estado = EXCLUDED.estado,
      updated_at = now()
    RETURNING *
  `;

  return upsert[0];
}
