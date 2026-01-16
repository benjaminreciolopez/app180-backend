// backend/src/services/jornadaEngine.js
import { sql } from "../db.js";
import { calcularMinutos, calcularDescansoJornada } from "./jornadasCalculo.js";
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

    if (t === "entrada") {
      // si ya hay un trabajo abierto, lo dejamos (datos inconsistentes)
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

  // orden final por inicio
  bloques.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  return bloques;
}

function sumarMinutos(bloques, tipo) {
  return bloques
    .filter((b) => b.tipo === tipo)
    .reduce((acc, b) => acc + (b.minutos || 0), 0);
}

/**
 * Recalcula una jornada:
 * - Lee jornada + fichajes
 * - Calcula bloques, trabajados, descanso, extras
 * - Trae plan del día (si existe plantilla)
 * - Genera incidencias informativas (no bloqueantes)
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

  // 6) Avisos informativos
  const avisos = [];

  const descansosEsperados = (plan?.bloques || []).filter((b) =>
    String(b.tipo).includes("descanso")
  );

  if (descansosEsperados.length > 0 && minutosDescanso === 0) {
    avisos.push("No se ha registrado descanso");
  }

  if (bloquesReales.length === 0) {
    avisos.push("No hay bloques de trabajo detectados");
  }

  // 7) Extras
  const horasObjetivo = null; // más adelante: desde turno / plantilla
  const minutosExtra = calcularExtras({
    minutos_trabajados: minutosTrabajados,
    horas_objetivo_dia: horasObjetivo || 8,
  });

  // 8) Resumen JSON (clave para frontend)
  const resumen = {
    fecha: fechaDia,
    plantilla_id: plan?.plantilla_id ?? null,
    plan_modo: plan?.modo ?? null,
    rango_esperado: plan?.rango ?? null,
    bloques_esperados: plan?.bloques ?? [],
    bloques_reales: bloquesReales,
    minutos_trabajados: minutosTrabajados,
    minutos_descanso: minutosDescanso,
    minutos_extra: minutosExtra,
    avisos,
  };

  // 9) Persistir en jornada
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
